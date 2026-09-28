import { invokeFunction } from './functions'
import { supabase } from './supabase'

export type EmailStatus = 'draft' | 'sending' | 'sent' | 'failed'
export type EmailType = 'invite' | 'rejection' | 'acknowledgement'

export type Email = {
  id: string
  candidate_id: string
  type: EmailType
  status: EmailStatus
  to_email: string | null
  subject: string
  body: string
  resend_id: string | null
  last_error: string | null
  attempts: number
  generated_by: string | null
  warnings: string[]
  edited_by_founder: boolean
  from_email: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
  candidates: { display_label: string | null; is_demo: boolean; decision_status: string } | null
}

export const TYPE_LABEL: Record<EmailType, string> = { invite: 'Invite', rejection: 'Rejection', acknowledgement: 'Acknowledgement' }

export async function listEmails(): Promise<Email[]> {
  const { data, error } = await supabase
    .from('emails')
    .select(`id, candidate_id, type, status, to_email, subject, body, resend_id, last_error, attempts, generated_by,
      warnings, edited_by_founder, from_email, sent_at, created_at, updated_at,
      candidates(display_label, is_demo, decision_status)`)
    .order('created_at', { ascending: false })
    .overrideTypes<Email[], { merge: false }>()
  if (error) throw error
  return data ?? []
}

export async function updateDraft(email: Email, patch: { to_email: string | null; subject: string; body: string }) {
  const { error } = await supabase.from('emails').update({ ...patch, edited_by_founder: true }).eq('id', email.id)
  if (error) throw error
  await supabase.from('audit_log').insert({
    action: 'email_draft_edited', entity: 'emails', entity_id: email.id,
    details: { fields: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== email[k as keyof Email]) },
  })
}

export async function discardDraft(email: Email) {
  const { error } = await supabase.from('emails').delete().eq('id', email.id)
  if (error) throw error
  await supabase.from('audit_log').insert({ action: 'email_draft_discarded', entity: 'emails', entity_id: email.id, details: { type: email.type } })
}

export type DraftResult = { ok: true; drafted: boolean; type?: EmailType; warnings?: string[]; discarded: number; reason?: string }
/** Brings the candidate's unsent draft in line with their latest decision. Never sends. */
export function syncDraft(candidateId: string) {
  return invokeFunction<DraftResult>('draft-email', { candidate_id: candidateId })
}

export type SendResult = {
  ok: true
  sent: number
  failed: number
  skipped: number
  results: { id: string; status: 'sent' | 'failed' | 'skipped'; error?: string }[]
}
/** Sends the given drafts. Only ever called from an explicit Send click. */
export function sendEmails(ids: string[]) {
  return invokeFunction<SendResult>('send-email', { email_ids: ids })
}

/** Candidates whose decision calls for an email but who have none of that type yet. */
export async function candidatesMissingDrafts(): Promise<string[]> {
  const { data, error } = await supabase
    .from('candidates')
    .select('id, decision_status, emails(type)')
    .in('decision_status', ['move_forward', 'pass'])
  if (error) throw error
  return (data ?? [])
    .filter((c) => !(c.emails as { type: string }[]).some((e) => e.type === (c.decision_status === 'move_forward' ? 'invite' : 'rejection')))
    .map((c) => c.id)
}

/** Runs syncDraft for many candidates, 3 at a time. */
export async function syncDrafts(ids: string[], onProgress?: (done: number) => void): Promise<{ drafted: number; failed: number }> {
  let next = 0, drafted = 0, failed = 0, done = 0
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]
      try {
        const r = await syncDraft(id)
        if (r.drafted) drafted++
      } catch {
        failed++
      }
      onProgress?.(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker))
  return { drafted, failed }
}
