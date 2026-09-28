import { invokeFunction } from './functions'
import { supabase } from './supabase'

export type RequirementKind = 'must_have' | 'nice_to_have' | 'not_scored' | 'responsibility'

export type Requirement = {
  id: string
  jd_id: string
  kind: RequirementKind
  text: string
  synonyms: string[]
  source_quote: string | null
  quote_verified: boolean | null
  note: string | null
  origin: 'ai' | 'founder'
  sort_order: number
}

export type JobDescription = {
  id: string
  role_id: string
  version: number
  status: 'draft' | 'saved'
  source_text: string | null
  source_file_name: string | null
  years_required_min: number | null
  years_required_max: number | null
  extraction_model: string | null
  extracted_at: string | null
  saved_at: string | null
  warnings: string[]
  jd_requirements: Requirement[]
}

export type Role = { id: string; code: string; title: string; job_descriptions: JobDescription[] }

export const KIND_LABEL: Record<RequirementKind, string> = {
  must_have: 'Must-have',
  nice_to_have: 'Nice-to-have',
  not_scored: 'Not scored',
  responsibility: 'Key responsibility',
}

export async function listRolesWithJds(): Promise<Role[]> {
  const { data, error } = await supabase
    .from('roles')
    .select(`id, code, title, job_descriptions(id, role_id, version, status, source_text, source_file_name,
      years_required_min, years_required_max, extraction_model, extracted_at, saved_at, warnings,
      jd_requirements(id, jd_id, kind, text, synonyms, source_quote, quote_verified, note, origin, sort_order))`)
    .eq('is_active', true)
    .order('sort_order')
    .order('version', { referencedTable: 'job_descriptions', ascending: false })
    .returns<Role[]>()
  if (error) throw error
  return (data ?? []).map((r) => ({
    ...r,
    job_descriptions: r.job_descriptions.map((j) => ({
      ...j,
      jd_requirements: [...j.jd_requirements].sort((a, b) => a.sort_order - b.sort_order),
    })),
  }))
}

async function audit(action: string, entityId: string, details: Record<string, unknown>) {
  await supabase.from('audit_log').insert({ action, entity: 'job_descriptions', entity_id: entityId, details })
}

export async function createDraft(roleId: string, sourceText: string, fileName: string | null): Promise<string> {
  const { data: last } = await supabase
    .from('job_descriptions')
    .select('version')
    .eq('role_id', roleId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await supabase
    .from('job_descriptions')
    .insert({ role_id: roleId, version: (last?.version ?? 0) + 1, status: 'draft', source_text: sourceText, source_file_name: fileName })
    .select('id')
    .single()
  if (error) throw error
  await audit('job_description_created', data.id, { file_name: fileName })
  return data.id
}

export function extractRequirements(jdId: string) {
  return invokeFunction<{ ok: true; counts: Record<string, number>; warnings: string[] }>('extract-jd-requirements', { jd_id: jdId })
}

export async function updateYears(jdId: string, min: number | null, max: number | null) {
  const { error } = await supabase.from('job_descriptions').update({ years_required_min: min, years_required_max: max }).eq('id', jdId)
  if (error) throw error
  await audit('job_description_years_updated', jdId, { min, max })
}

export type RequirementInput = Pick<Requirement, 'kind' | 'text' | 'synonyms'>

export async function updateRequirement(req: Requirement, input: RequirementInput) {
  const { error } = await supabase.from('jd_requirements').update(input).eq('id', req.id)
  if (error) throw error
  await audit('jd_requirement_edited', req.jd_id, { requirement_id: req.id, before: { kind: req.kind, text: req.text, synonyms: req.synonyms }, after: input })
}

export async function addRequirement(jdId: string, input: RequirementInput, sortOrder: number) {
  const { error } = await supabase
    .from('jd_requirements')
    .insert({ ...input, jd_id: jdId, origin: 'founder', sort_order: sortOrder })
  if (error) throw error
  await audit('jd_requirement_added', jdId, input)
}

export async function deleteRequirement(req: Requirement) {
  const { error } = await supabase.from('jd_requirements').delete().eq('id', req.id)
  if (error) throw error
  await audit('jd_requirement_deleted', req.jd_id, { text: req.text, kind: req.kind })
}

export async function saveJd(jdId: string) {
  const { error } = await supabase.rpc('save_job_description', { p_jd_id: jdId })
  if (error) throw error
}

export async function cloneJd(jdId: string): Promise<string> {
  const { data, error } = await supabase.rpc('clone_jd_as_draft', { p_jd_id: jdId })
  if (error) throw error
  return data as string
}
