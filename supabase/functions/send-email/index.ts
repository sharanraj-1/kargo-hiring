// Sends email drafts through Resend. ONLY on an explicit founder click:
// this function accepts the founder's session and nothing else (no service-role path).
//
// Each email is claimed atomically (draft/failed -> sending) so a double click can't send twice,
// and the Resend call carries an idempotency key per attempt. Resend's response is recorded as
// the delivery status: sent (with its id) or failed (with its error message) for a retry.
import { HttpError, requireFounder } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const MAX_BATCH = 100
const PAUSE_MS = 600 // stay under Resend's default rate limit when sending in bulk

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function toHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join('\n')
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const founder = await requireFounder(req)
    const admin = founder.admin
    const { email_ids } = await req.json().catch(() => ({}))
    if (!Array.isArray(email_ids) || !email_ids.length || email_ids.some((i) => typeof i !== 'string')) {
      throw new HttpError(400, 'email_ids is required')
    }
    if (email_ids.length > MAX_BATCH) throw new HttpError(400, `Send at most ${MAX_BATCH} emails at a time`)

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) throw new HttpError(500, 'RESEND_API_KEY is not set')
    const { data: settings } = await admin.from('settings').select('sender_name, sender_email, founder_name').eq('id', 1).single()
    const address = settings?.sender_email || Deno.env.get('RESEND_FROM') || 'onboarding@resend.dev'
    const name = settings?.sender_name || settings?.founder_name
    const from = /</.test(address) ? address : name ? `${name} <${address}>` : address

    const results: { id: string; status: 'sent' | 'failed' | 'skipped'; error?: string; resend_id?: string }[] = []
    for (const [i, id] of email_ids.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS))

      const { data: email } = await admin
        .from('emails')
        .select('id, candidate_id, to_email, subject, body, status, attempts, candidates(is_demo)')
        .eq('id', id)
        .maybeSingle()
      if (!email) { results.push({ id, status: 'skipped', error: 'Not found' }); continue }
      const cand = Array.isArray(email.candidates) ? email.candidates[0] : email.candidates
      if (cand?.is_demo) { results.push({ id, status: 'skipped', error: 'DEMO candidate: emails are never sent' }); continue }
      if (!email.to_email || !EMAIL_RE.test(email.to_email)) {
        results.push({ id, status: 'skipped', error: 'Add a valid recipient email first' }); continue
      }

      // Atomic claim: only a draft or failed email can move to "sending".
      const attempt = (email.attempts ?? 0) + 1
      const { data: claimed } = await admin
        .from('emails')
        .update({ status: 'sending', attempts: attempt, from_email: from, last_error: null })
        .eq('id', id)
        .in('status', ['draft', 'failed'])
        .select('id')
        .maybeSingle()
      if (!claimed) { results.push({ id, status: 'skipped', error: 'Already sent or being sent' }); continue }

      let resendId: string | null = null
      let error: string | null = null
      try {
        const res = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `${id}-${attempt}`,
          },
          body: JSON.stringify({
            from,
            to: [email.to_email],
            reply_to: founder.email,
            subject: email.subject,
            text: email.body,
            html: toHtml(email.body),
          }),
          signal: AbortSignal.timeout(20_000),
        })
        const body = await res.json().catch(() => null)
        if (res.ok && body?.id) resendId = body.id
        else error = body?.message ? `Resend: ${body.message}` : `Resend returned HTTP ${res.status}`
      } catch (err) {
        error = `Could not reach Resend: ${err instanceof Error ? err.message : String(err)}`
      }

      const now = new Date().toISOString()
      if (resendId) {
        await admin.from('emails').update({ status: 'sent', resend_id: resendId, sent_at: now }).eq('id', id)
        await admin.from('candidates').update({ first_responded_at: now }).eq('id', email.candidate_id).is('first_responded_at', null)
        results.push({ id, status: 'sent', resend_id: resendId })
      } else {
        await admin.from('emails').update({ status: 'failed', last_error: error }).eq('id', id)
        results.push({ id, status: 'failed', error: error ?? 'Unknown error' })
      }
      await admin.from('audit_log').insert({
        actor: founder.userId, action: resendId ? 'email_sent' : 'email_send_failed', entity: 'emails', entity_id: id,
        details: { candidate_id: email.candidate_id, attempt, resend_id: resendId, error },
      })
    }

    return json({
      ok: true,
      sent: results.filter((r) => r.status === 'sent').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
