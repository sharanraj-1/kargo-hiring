// Sends a test email to the signed-in founder's own address, using the same sender settings
// as candidate emails. Confirms the Resend key and sender are working before anything real is sent.
import { HttpError, requireFounder } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const founder = await requireFounder(req)
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) return json({ error: 'RESEND_API_KEY is not set' }, 500)

    const { data: s } = await founder.admin.from('settings').select('sender_name, sender_email, founder_name, signature').eq('id', 1).single()
    const address = s?.sender_email || Deno.env.get('RESEND_FROM') || 'onboarding@resend.dev'
    const name = s?.sender_name || s?.founder_name
    const from = /</.test(address) ? address : name ? `${name} <${address}>` : address

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [founder.email],
        subject: 'Kargo Hiring: test email',
        text: `This is a test from the Kargo Hiring dashboard. If you can read it, sending works from ${from}.\n\n${s?.signature ?? ''}`.trim(),
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const body = await res.json().catch(() => null)
    await founder.admin.from('audit_log').insert({
      actor: founder.userId, action: 'test_email_sent', entity: 'settings',
      details: { from, to: founder.email, ok: res.ok, resend_id: body?.id ?? null, error: res.ok ? null : body?.message ?? `HTTP ${res.status}` },
    })
    if (!res.ok || !body?.id) return json({ ok: false, from, error: body?.message ?? `Resend returned HTTP ${res.status}` }, 502)
    return json({ ok: true, id: body.id, to: founder.email, from })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
