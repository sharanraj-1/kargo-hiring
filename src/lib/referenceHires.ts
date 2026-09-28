import { extractText, resolveMimeType } from './extract'
import { supabase } from './supabase'

export type Rating = 'exceeds' | 'meets' | 'below'
export type Tenure = 'yes' | 'no_left' | 'no_let_go'
export type ReferenceType = 'positive' | 'neutral' | 'negative' | 'unclassified'

export type ReferenceDoc = {
  id: string
  reference_hire_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  text_chars: number | null
  is_readable: boolean | null
  created_at: string
}

export type AiProfile = {
  role_expectations: { expectation: string; verdict: 'strong' | 'adequate' | 'weak' | 'not_evidenced'; quote: string | null; reasoning: string }[]
  stands_out: { point: string; quote: string }[]
  gaps: { point: string; quote: string | null }[]
  summary: string
  warnings: string[]
  bias_flags: string[]
  role_expectations_source: string
}

export type ReferenceHire = {
  id: string
  name: string
  role_title: string
  joined_on: string | null
  last_rating: Rating | null
  still_at_kargo: Tenure | null
  is_product_role: boolean
  application_standout: string | null
  interview_revealed: string | null
  outcome_note: string | null
  reference_type: ReferenceType
  ai_profile: AiProfile | null
  ai_profile_model: string | null
  ai_profiled_at: string | null
  reference_docs: ReferenceDoc[]
}

export type ReferenceHireInput = Omit<
  ReferenceHire,
  'id' | 'reference_type' | 'reference_docs' | 'ai_profile' | 'ai_profile_model' | 'ai_profiled_at'
>

export const RATING_LABEL: Record<Rating, string> = { exceeds: 'Exceeds', meets: 'Meets', below: 'Below' }
export const TENURE_LABEL: Record<Tenure, string> = { yes: 'Yes', no_left: 'No – left', no_let_go: 'No – let go' }

const DOC_COLUMNS = 'id, reference_hire_id, storage_path, file_name, mime_type, size_bytes, text_chars, is_readable, created_at'
const HIRE_COLUMNS = `id, name, role_title, joined_on, last_rating, still_at_kargo, is_product_role,
  application_standout, interview_revealed, outcome_note, reference_type,
  ai_profile, ai_profile_model, ai_profiled_at, reference_docs(${DOC_COLUMNS})`

async function audit(action: string, entityId: string | null, details: Record<string, unknown>) {
  await supabase.from('audit_log').insert({ action, entity: 'reference_hires', entity_id: entityId, details })
}

export async function listReferenceHires(): Promise<ReferenceHire[]> {
  const { data, error } = await supabase
    .from('reference_hires')
    .select(HIRE_COLUMNS)
    .order('joined_on', { nullsFirst: false })
    .order('created_at', { referencedTable: 'reference_docs' })
    .returns<ReferenceHire[]>()
  if (error) throw error
  return data ?? []
}

export async function saveReferenceHire(id: string | null, input: ReferenceHireInput): Promise<string> {
  if (id) {
    const { error } = await supabase.from('reference_hires').update(input).eq('id', id)
    if (error) throw error
    await audit('reference_hire_updated', id, { fields: Object.keys(input) })
    return id
  }
  const { data, error } = await supabase.from('reference_hires').insert(input).select('id').single()
  if (error) throw error
  await audit('reference_hire_created', data.id, { name: input.name })
  return data.id
}

export async function deleteReferenceHire(hire: ReferenceHire) {
  const paths = hire.reference_docs.map((d) => d.storage_path)
  if (paths.length) {
    const { error } = await supabase.storage.from('reference_docs').remove(paths)
    if (error) throw error
  }
  const { error } = await supabase.from('reference_hires').delete().eq('id', hire.id)
  if (error) throw error
  await audit('reference_hire_deleted', hire.id, { name: hire.name, documents: paths.length })
}

function safeFileName(name: string) {
  return name.replace(/[^\w.-]+/g, '_').slice(-120)
}

export type UploadResult = { fileName: string; ok: boolean; readable?: boolean; chars?: number; error?: string }

export async function uploadReferenceDoc(hireId: string, file: File): Promise<UploadResult> {
  const mime = resolveMimeType(file)
  if (!mime) return { fileName: file.name, ok: false, error: 'Unsupported file type. Use PDF, DOCX or TXT.' }

  let extraction
  try {
    extraction = await extractText(file)
  } catch (err) {
    return { fileName: file.name, ok: false, error: err instanceof Error ? err.message : 'Could not read file' }
  }

  const path = `${hireId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from('reference_docs')
    .upload(path, file, { contentType: mime, upsert: false })
  if (uploadError) return { fileName: file.name, ok: false, error: uploadError.message }

  const { data, error } = await supabase
    .from('reference_docs')
    .insert({
      reference_hire_id: hireId,
      storage_path: path,
      file_name: file.name,
      mime_type: mime,
      size_bytes: file.size,
      extracted_text: extraction.readable ? extraction.text : null,
      text_chars: extraction.chars,
      is_readable: extraction.readable,
    })
    .select('id')
    .single()
  if (error) {
    // Don't leave an orphaned file in storage.
    await supabase.storage.from('reference_docs').remove([path])
    return { fileName: file.name, ok: false, error: error.message }
  }

  await audit('reference_doc_uploaded', hireId, {
    doc_id: data.id,
    file_name: file.name,
    chars: extraction.chars,
    readable: extraction.readable,
  })
  return { fileName: file.name, ok: true, readable: extraction.readable, chars: extraction.chars }
}

export async function deleteReferenceDoc(doc: ReferenceDoc) {
  const { error: storageError } = await supabase.storage.from('reference_docs').remove([doc.storage_path])
  if (storageError) throw storageError
  const { error } = await supabase.from('reference_docs').delete().eq('id', doc.id)
  if (error) throw error
  await audit('reference_doc_deleted', doc.reference_hire_id, { doc_id: doc.id, file_name: doc.file_name })
}

export async function openReferenceDoc(doc: ReferenceDoc) {
  const { data, error } = await supabase.storage.from('reference_docs').createSignedUrl(doc.storage_path, 60)
  if (error) throw error
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
}
