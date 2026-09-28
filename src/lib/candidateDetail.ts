import type { DecisionStatus, Tier } from './candidates'
import { invokeFunction } from './functions'
import { supabase } from './supabase'

export type Component = { key: string; label: string; score: number; max: number; explanation: string }
export type RequirementCredit = {
  id: string
  kind: 'must_have' | 'nice_to_have'
  text: string
  keyword_hit: string | null
  ai_status: 'met' | 'partial' | 'not_evidenced'
  quote: string | null
  credit: number
}
export type SignalResult = { signal_id: string; name: string; score: number; quote: string | null; quote_verified: boolean; reasoning: string }
export type Probe = {
  question: string
  why: string
  listen_for: string
  target: { id: string; type: 'gap' | 'red_flag' | 'signal'; label: string; detail?: string }
}

export type Evaluation = {
  id: string
  role_id: string
  ats_score: number
  pattern_score: number
  overall_score: number
  tier: Tier
  summary: string | null
  strengths: { point: string; quote: string }[]
  gaps: { point: string; quote: string | null }[]
  red_flags: { type: string; text: string }[]
  bias_flags: string[]
  ats_breakdown: Component[]
  requirement_matches: RequirementCredit[]
  signal_scores: SignalResult[]
  interview_brief: { probes: Probe[]; warnings: string[]; model: string; generated_at: string } | null
  years_product_experience: number | null
  weights_used: { ats_weight: number; pattern_weight: number }
  model: string
  prompt_version: string
  created_at: string
  roles: { id: string; code: string; title: string }
  success_patterns: { version: number } | null
}

export type Decision = {
  id: string
  decision: Exclude<DecisionStatus, 'awaiting'>
  ai_recommendation: string | null
  is_override: boolean
  reason: string | null
  decided_at: string
}

export type CandidateDetail = {
  id: string
  applied_role_id: string
  recommended_role_id: string | null
  status: string
  decision_status: DecisionStatus
  is_demo: boolean
  display_label: string | null
  applied_on: string | null
  uploaded_at: string
  first_responded_at: string | null
  structured_cv: { experience: { title: string; company: string | null; start: string | null; end: string | null }[] } | null
  candidate_pii: { full_name: string | null; email: string | null; phone: string | null; location: string | null; profile_urls: string[] } | null
  candidate_files: { storage_path: string; file_name: string; mime_type: string | null; extracted_text: string | null }[]
  evaluations: (Evaluation & { is_current: boolean })[]
  decisions: Decision[]
}

export async function getCandidateDetail(id: string): Promise<CandidateDetail> {
  const { data, error } = await supabase
    .from('candidates')
    .select(`id, applied_role_id, recommended_role_id, status, decision_status, is_demo, display_label, applied_on,
      uploaded_at, first_responded_at, structured_cv,
      candidate_pii(full_name, email, phone, location, profile_urls),
      candidate_files(storage_path, file_name, mime_type, extracted_text),
      evaluations(id, role_id, is_current, ats_score, pattern_score, overall_score, tier, summary, strengths, gaps,
        red_flags, bias_flags, ats_breakdown, requirement_matches, signal_scores, interview_brief,
        years_product_experience, weights_used, model, prompt_version, created_at,
        roles!evaluations_role_id_fkey(id, code, title), success_patterns(version)),
      decisions(id, decision, ai_recommendation, is_override, reason, decided_at)`)
    .eq('id', id)
    .order('decided_at', { referencedTable: 'decisions', ascending: false })
    .single()
    .overrideTypes<CandidateDetail, { merge: false }>()
  if (error) throw error
  return { ...data, evaluations: data.evaluations.filter((e) => e.is_current) }
}

export async function recordDecision(candidateId: string, decision: Exclude<DecisionStatus, 'awaiting'>, reason: string) {
  const { error } = await supabase.rpc('record_decision', { p_candidate_id: candidateId, p_decision: decision, p_reason: reason || null })
  if (error) throw error
}

export async function recordBulkPass(candidateIds: string[], reason: string): Promise<number> {
  const { data, error } = await supabase.rpc('record_decisions_bulk', { p_candidate_ids: candidateIds, p_decision: 'pass', p_reason: reason || null })
  if (error) throw error
  return data as number
}

export function regenerateBrief(evaluationId: string) {
  return invokeFunction<{ ok: true; probes: number; warnings: string[] }>('generate-interview-brief', { evaluation_id: evaluationId })
}

export async function signedCvUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('cvs').createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}

export const AI_RECOMMENDATION: Record<Tier, Exclude<DecisionStatus, 'awaiting'>> = {
  strong_fit: 'move_forward',
  consider: 'hold',
  below_threshold: 'pass',
}

export const DECISION_LABEL: Record<Exclude<DecisionStatus, 'awaiting'>, string> = {
  move_forward: 'Move forward',
  hold: 'Hold',
  pass: 'Pass',
}
