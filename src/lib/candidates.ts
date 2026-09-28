import { extractText, MAX_FILE_BYTES, resolveMimeType } from './extract'
import { invokeFunction } from './functions'
import { supabase } from './supabase'

export type CandidateStatus = 'uploaded' | 'parsed' | 'scored' | 'unreadable' | 'error'
export type DecisionStatus = 'awaiting' | 'move_forward' | 'hold' | 'pass'
export type Tier = 'strong_fit' | 'consider' | 'below_threshold'

export type EvaluationSummary = {
  id: string
  role_id: string
  overall_score: number | null
  ats_score: number | null
  pattern_score: number | null
  tier: Tier | null
  red_flags: { type: string; text: string }[] | null
  bias_flags: string[] | null
  is_current: boolean
}

export type CandidateRow = {
  id: string
  applied_role_id: string
  recommended_role_id: string | null
  status: CandidateStatus
  decision_status: DecisionStatus
  is_priority: boolean
  is_demo: boolean
  display_label: string | null
  applied_on: string | null
  uploaded_at: string
  first_responded_at: string | null
  needs_attention: string | null
  error_message: string | null
  candidate_files: { file_name: string }[]
  evaluations: EvaluationSummary[]
}

export const TIER_LABEL: Record<Tier, string> = {
  strong_fit: 'Strong Fit',
  consider: 'Consider',
  below_threshold: 'Below Threshold',
}

export async function listCandidates(): Promise<CandidateRow[]> {
  const { data, error } = await supabase
    .from('candidates')
    .select(`id, applied_role_id, recommended_role_id, status, decision_status, is_priority, is_demo, display_label,
      applied_on, uploaded_at, first_responded_at, needs_attention, error_message,
      candidate_files(file_name),
      evaluations(id, role_id, overall_score, ats_score, pattern_score, tier, red_flags, bias_flags, is_current)`)
    .order('uploaded_at', { ascending: false })
    .returns<CandidateRow[]>()
  if (error) throw error
  return (data ?? []).map((c) => ({ ...c, evaluations: c.evaluations.filter((e) => e.is_current) }))
}

export type Role = { id: string; code: string; title: string }
export async function listRoles(): Promise<Role[]> {
  const { data, error } = await supabase.from('roles').select('id, code, title').eq('is_active', true).order('sort_order')
  if (error) throw error
  return data ?? []
}

/** What scoring needs before it can run. */
export async function scoringReadiness(): Promise<{ patternApproved: boolean; rolesWithoutSavedJd: string[] }> {
  const [p, roles] = await Promise.all([
    supabase.from('success_patterns').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('roles').select('title, job_descriptions(status)').eq('is_active', true),
  ])
  return {
    patternApproved: (p.count ?? 0) > 0,
    rolesWithoutSavedJd: (roles.data ?? [])
      .filter((r) => !(r.job_descriptions as { status: string }[]).some((j) => j.status === 'saved'))
      .map((r) => r.title),
  }
}

export type IntakeStage = 'queued' | 'reading' | 'uploading' | 'scoring' | 'scored' | 'unreadable' | 'needs_name' | 'error'

/** Upload one CV: extract text in the browser, store the file privately, create the candidate. */
export async function intakeFile(
  file: File,
  roleId: string,
  batchId: string,
  onStage: (stage: IntakeStage, detail?: string) => void,
): Promise<{ id: string | null; scorable: boolean }> {
  const mime = resolveMimeType(file)
  if (!mime) { onStage('error', 'Unsupported file type (PDF, DOCX or TXT only)'); return { id: null, scorable: false } }
  if (file.size > MAX_FILE_BYTES) { onStage('error', 'Larger than 10 MB'); return { id: null, scorable: false } }

  onStage('reading')
  let extraction
  try {
    extraction = await extractText(file)
  } catch (err) {
    onStage('error', err instanceof Error ? err.message : 'Could not read file')
    return { id: null, scorable: false }
  }

  onStage('uploading')
  const { data: cand, error } = await supabase
    .from('candidates')
    .insert({
      applied_role_id: roleId,
      upload_batch_id: batchId,
      status: extraction.readable ? 'uploaded' : 'unreadable',
      needs_attention: extraction.readable ? null : 'Unreadable – needs manual review',
      text_chars: extraction.chars,
      applied_on: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  if (error) { onStage('error', error.message); return { id: null, scorable: false } }

  const path = `${cand.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_').slice(-120)}`
  const up = await supabase.storage.from('cvs').upload(path, file, { contentType: mime, upsert: false })
  if (up.error) {
    await supabase.from('candidates').update({ status: 'error', error_message: `Upload failed: ${up.error.message}` }).eq('id', cand.id)
    onStage('error', up.error.message)
    return { id: cand.id, scorable: false }
  }
  const { error: fileErr } = await supabase.from('candidate_files').insert({
    candidate_id: cand.id,
    storage_path: path,
    file_name: file.name,
    mime_type: mime,
    size_bytes: file.size,
    extracted_text: extraction.text,
    text_chars: extraction.chars,
  })
  if (fileErr) { onStage('error', fileErr.message); return { id: cand.id, scorable: false } }

  await supabase.from('audit_log').insert({
    action: 'candidate_uploaded', entity: 'candidates', entity_id: cand.id,
    details: { file_name: file.name, chars: extraction.chars, readable: extraction.readable, batch_id: batchId },
  })

  if (!extraction.readable) { onStage('unreadable', `${extraction.chars} characters of text`); return { id: cand.id, scorable: false } }
  return { id: cand.id, scorable: true }
}

export type ScoreResult = { ok: boolean; status: 'scored' | 'unreadable' | 'needs_name' }
export function scoreCandidate(candidateId: string) {
  return invokeFunction<ScoreResult>('score-candidate', { candidate_id: candidateId })
}

/** Founder supplies a name the parser couldn't find; it's used for redaction, then scoring retries. */
export async function setCandidateName(candidateId: string, fullName: string) {
  const { error } = await supabase
    .from('candidate_pii')
    .upsert({ candidate_id: candidateId, full_name: fullName.trim(), other: { name_source: 'founder' } })
  if (error) throw error
  await supabase.from('audit_log').insert({ action: 'candidate_name_entered', entity: 'candidates', entity_id: candidateId, details: {} })
}

export async function setPriority(candidateId: string, isPriority: boolean) {
  const { error } = await supabase.from('candidates').update({ is_priority: isPriority }).eq('id', candidateId)
  if (error) throw error
  await supabase.from('audit_log').insert({ action: isPriority ? 'candidate_pinned' : 'candidate_unpinned', entity: 'candidates', entity_id: candidateId, details: {} })
}

export async function deleteDemoCandidates(): Promise<number> {
  const { data: files } = await supabase.from('candidate_files').select('storage_path, candidates!inner(is_demo)').eq('candidates.is_demo', true)
  const paths = (files ?? []).map((f) => f.storage_path)
  if (paths.length) {
    const { error } = await supabase.storage.from('cvs').remove(paths)
    if (error) throw error
  }
  const { data, error } = await supabase.rpc('delete_demo_candidates')
  if (error) throw error
  return data as number
}

export function daysWaiting(c: Pick<CandidateRow, 'first_responded_at' | 'applied_on' | 'uploaded_at'>, now = Date.now()): number | null {
  if (c.first_responded_at) return null
  const from = new Date(c.applied_on ? `${c.applied_on}T00:00:00` : c.uploaded_at).getTime()
  return Math.max(0, Math.floor((now - from) / 86_400_000))
}
