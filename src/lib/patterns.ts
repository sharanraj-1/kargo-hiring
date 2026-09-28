import { invokeFunction } from './functions'
import type { ReferenceType } from './referenceHires'
import { supabase } from './supabase'

export type PatternStatus = 'draft' | 'approved' | 'superseded'
export type Confidence = 'high' | 'medium' | 'low'

export type PatternSummary = {
  id: string
  version: number
  status: PatternStatus
  sample_size: number
  model: string | null
  prompt_version: string | null
  generated_at: string | null
  approved_at: string | null
  notes: string | null
  warnings: string[]
  created_at: string
}

export type SignalQuote = { reference_hire_id: string; hire_name: string; reference_type: ReferenceType; quote: string }
export type SignalCounter = { reference_hire_id: string; hire_name: string; reference_type: ReferenceType; note: string }

export type Signal = {
  id: string
  pattern_id: string
  name: string
  description: string
  observable_evidence: string
  reference_quotes: SignalQuote[]
  counter_examples: SignalCounter[]
  confidence: Confidence
  confidence_rationale: string | null
  bias_flags: string[]
  origin: 'ai' | 'founder'
  edited_by_founder: boolean
  sort_order: number
}

export type SignalInput = Pick<Signal, 'name' | 'description' | 'observable_evidence' | 'confidence'>

export async function listPatterns(): Promise<PatternSummary[]> {
  const { data, error } = await supabase
    .from('success_patterns')
    .select('id, version, status, sample_size, model, prompt_version, generated_at, approved_at, notes, warnings, created_at')
    .order('version', { ascending: false })
    .returns<PatternSummary[]>()
  if (error) throw error
  return data ?? []
}

export async function listSignals(patternId: string): Promise<Signal[]> {
  const { data, error } = await supabase
    .from('success_signals')
    .select('*')
    .eq('pattern_id', patternId)
    .order('sort_order')
    .returns<Signal[]>()
  if (error) throw error
  return data ?? []
}

async function audit(action: string, entityId: string, details: Record<string, unknown>) {
  await supabase.from('audit_log').insert({ action, entity: 'success_signals', entity_id: entityId, details })
}

export async function updateSignal(signal: Signal, input: SignalInput) {
  const { error } = await supabase
    .from('success_signals')
    .update({ ...input, edited_by_founder: true })
    .eq('id', signal.id)
  if (error) throw error
  await audit('success_signal_edited', signal.id, {
    before: { name: signal.name, description: signal.description, observable_evidence: signal.observable_evidence, confidence: signal.confidence },
    after: input,
  })
}

export async function deleteSignal(signal: Signal) {
  const { error } = await supabase.from('success_signals').delete().eq('id', signal.id)
  if (error) throw error
  await audit('success_signal_deleted', signal.id, { pattern_id: signal.pattern_id, name: signal.name })
}

export async function addSignal(patternId: string, input: SignalInput, sortOrder: number) {
  const { data, error } = await supabase
    .from('success_signals')
    .insert({ ...input, pattern_id: patternId, origin: 'founder', edited_by_founder: true, sort_order: sortOrder })
    .select('id')
    .single()
  if (error) throw error
  await audit('success_signal_added', data.id, { pattern_id: patternId, name: input.name })
}

export async function approvePattern(patternId: string) {
  const { error } = await supabase.rpc('approve_pattern', { p_pattern_id: patternId })
  if (error) throw error
}

export async function cloneAsDraft(patternId: string): Promise<string> {
  const { data, error } = await supabase.rpc('clone_pattern_as_draft', { p_pattern_id: patternId })
  if (error) throw error
  return data as string
}

export type ExtractResult = { ok: true; pattern_id: string; version: number; sample_size: number; signals: number; warnings: string[] }

export function extractPattern() {
  return invokeFunction<ExtractResult>('extract-success-pattern')
}

export function profileReferenceHire(referenceHireId: string) {
  return invokeFunction<{ ok: true }>('profile-reference-hire', { reference_hire_id: referenceHireId })
}
