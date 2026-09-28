// Resend smoke test, adapted from Resend's quickstart snippet.
//
// Differences from the snippet, on purpose:
// - Runs server-side only; the API key comes from the RESEND_API_KEY secret, never from code.
// - Only the signed-in founder can call it, and it only sends to the founder's own
//   login email, so it cannot be used to email anyone else.
// - "From" uses RESEND_FROM when set; otherwise Resend's shared test sender
//   onboarding@resend.dev, which Resend only delivers to your own Resend account address.
import { Resend } from 'npm:resend@6.30.0'
import { HttpError, requireFounder } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const founder = await requireFounder(req)

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) return json({ error: 'RESEND_API_KEY is not set' }, 500)

    const resend = new Resend(apiKey)
    const from = Deno.env.get('RESEND_FROM') ?? 'onboarding@resend.dev'

    const { data, error } = await resend.emails.send({
      from,
      to: founder.email,
      subject: 'Hello World',
      html: '<p>Congrats on sending your <strong>first email</strong>!</p>',
    })

    if (error) return json({ ok: false, error }, 502)
    return json({ ok: true, id: data?.id, to: founder.email, from })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
