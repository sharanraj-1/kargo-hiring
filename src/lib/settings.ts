import { invokeFunction } from './functions'
import { supabase } from './supabase'

export type TemplateSet = Record<'invite' | 'rejection' | 'acknowledgement', { subject: string; body: string }>

export type Settings = {
  ats_weight: number
  pattern_weight: number
  strong_threshold: number
  consider_threshold: number
  recommend_role_delta: number
  response_sla_days: number
  founder_name: string | null
  founder_title: string | null
  sender_name: string | null
  sender_email: string | null
  signature: string | null
  scheduling_link: string | null
  keep_cv_on_file: boolean
  email_drafting: 'ai' | 'template'
  templates: TemplateSet
}

export type RoleRow = { id: string; code: string; title: string; opened_on: string | null; is_active: boolean; sort_order: number }

const COLUMNS = `ats_weight, pattern_weight, strong_threshold, consider_threshold, recommend_role_delta, response_sla_days,
  founder_name, founder_title, sender_name, sender_email, signature, scheduling_link, keep_cv_on_file, email_drafting, templates`

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase.from('settings').select(COLUMNS).eq('id', 1).single()
  if (error) throw error
  const n = (v: unknown) => Number(v)
  return {
    ...(data as unknown as Settings),
    ats_weight: n(data.ats_weight), pattern_weight: n(data.pattern_weight),
    strong_threshold: n(data.strong_threshold), consider_threshold: n(data.consider_threshold),
    recommend_role_delta: n(data.recommend_role_delta),
  }
}

async function audit(action: string, details: Record<string, unknown>) {
  await supabase.from('audit_log').insert({ action, entity: 'settings', details })
}

export async function saveSettings(patch: Partial<Settings>, section: string) {
  const { error } = await supabase.from('settings').update(patch).eq('id', 1)
  if (error) throw error
  await audit('settings_updated', { section, fields: Object.keys(patch) })
}

/** Re-ranks every current evaluation from stored ATS/Pattern scores. No AI calls. */
export async function recomputeScores(): Promise<number> {
  const { data, error } = await supabase.rpc('recompute_scores')
  if (error) throw error
  return data as number
}

export async function listAllRoles(): Promise<RoleRow[]> {
  const { data, error } = await supabase.from('roles').select('id, code, title, opened_on, is_active, sort_order').order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function updateRole(id: string, patch: Partial<Pick<RoleRow, 'title' | 'opened_on' | 'is_active'>>) {
  const { error } = await supabase.from('roles').update(patch).eq('id', id)
  if (error) throw error
  await supabase.from('audit_log').insert({ action: 'role_updated', entity: 'roles', entity_id: id, details: patch })
}

export async function addRole(code: string, title: string, sortOrder: number) {
  const { data, error } = await supabase.from('roles').insert({ code, title, sort_order: sortOrder }).select('id').single()
  if (error) throw error
  await supabase.from('audit_log').insert({ action: 'role_created', entity: 'roles', entity_id: data.id, details: { code, title } })
}

export function sendTestEmail() {
  return invokeFunction<{ ok: boolean; to?: string; from?: string; error?: string }>('send-test-email')
}
