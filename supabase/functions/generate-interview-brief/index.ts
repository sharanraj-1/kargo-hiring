// Generates (or regenerates) the interview brief for one evaluation.
import { HttpError, requireFounderOrService } from '../_shared/auth.ts'
import { BRIEF_PROMPT_VERSION, buildAndStoreBrief } from '../_shared/brief.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { GeminiError } from '../_shared/gemini.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const ctx = await requireFounderOrService(req)
    const { evaluation_id } = await req.json().catch(() => ({}))
    if (typeof evaluation_id !== 'string') throw new HttpError(400, 'evaluation_id is required')
    const result = await buildAndStoreBrief(ctx.admin, evaluation_id)
    await ctx.admin.from('audit_log').insert({
      actor: ctx.userId, action: 'interview_brief_generated', entity: 'evaluations', entity_id: evaluation_id,
      details: { prompt_version: BRIEF_PROMPT_VERSION, ...result },
    })
    return json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    if (err instanceof GeminiError) return json({ error: err.message }, 502)
    console.error(err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
