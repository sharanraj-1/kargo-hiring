// Builds an evidence-backed AI profile for ONE reference hire.
//
// - Input text is PII- and institution-redacted before it leaves this function.
// - The model is NOT told the hire's rating, so the profile is not written to fit the outcome.
// - Every claim must carry a verbatim quote. Quotes that can't be found in the source are
//   downgraded to "not_evidenced"; nothing unverifiable is stored as evidence.
// - Role expectations come from the model's general knowledge and are labelled as such.
import { z } from 'npm:zod@4.6.5'
import { HttpError, requireFounderOrService } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { findBiasTerms, redact } from '../_shared/redact.ts'
import { GeminiError, generateJson, quoteIsVerbatim } from '../_shared/gemini.ts'

const PROMPT_VERSION = 'reference-profile/v1'

const SYSTEM = `You assess the CV of a past hire at Kargo, a Series A logistics SaaS company, to help calibrate hiring.

Rules you must follow:
1. Use ONLY the CV text provided. Never infer, assume or invent experience.
2. Every "quote" must be copied EXACTLY, character for character, from the CV text: a contiguous phrase or sentence. Do not paraphrase, merge or tidy it.
3. If something is not in the CV, set verdict "not_evidenced" and quote null. Do not guess.
4. Tokens in square brackets such as [NAME], [LOCATION], [INSTITUTION], [EMAIL] are redactions. Ignore them and never speculate about what they hide.
5. Never base any judgement on education institution, company brand or prestige, location, age, gender, or any personal characteristic. Judge observable behaviours, experiences and outcomes only.
6. "role_expectations" describe what the role typically requires at an early-stage startup, from general industry knowledge, not from this CV. Keep them concrete and observable.
7. Be concise and specific. No flattery.`

const VERDICTS = ['strong', 'adequate', 'weak', 'not_evidenced'] as const

const jsonSchema = {
  type: 'object',
  properties: {
    role_expectations: {
      type: 'array',
      description: '4 to 6 general expectations for this role at an early-stage B2B SaaS startup.',
      items: {
        type: 'object',
        properties: {
          expectation: { type: 'string' },
          verdict: { type: 'string', enum: VERDICTS },
          quote: { type: ['string', 'null'], description: 'Exact CV text evidencing the verdict, or null.' },
          reasoning: { type: 'string', description: 'One sentence.' },
        },
        required: ['expectation', 'verdict', 'quote', 'reasoning'],
      },
    },
    stands_out: {
      type: 'array',
      description: '2 to 4 things that genuinely stand out, each with an exact quote.',
      items: {
        type: 'object',
        properties: { point: { type: 'string' }, quote: { type: 'string' } },
        required: ['point', 'quote'],
      },
    },
    gaps: {
      type: 'array',
      description: '1 to 3 notable gaps or weak areas. Quote the CV if a weakness is visible; null if it is simply absent.',
      items: {
        type: 'object',
        properties: { point: { type: 'string' }, quote: { type: ['string', 'null'] } },
        required: ['point', 'quote'],
      },
    },
    summary: { type: 'string', description: 'Two plain sentences.' },
  },
  required: ['role_expectations', 'stands_out', 'gaps', 'summary'],
}

const validator = z.object({
  role_expectations: z
    .array(z.object({
      expectation: z.string().min(3),
      verdict: z.enum(VERDICTS),
      quote: z.string().nullable(),
      reasoning: z.string(),
    }))
    .min(3)
    .max(8),
  stands_out: z.array(z.object({ point: z.string(), quote: z.string() })).max(6),
  gaps: z.array(z.object({ point: z.string(), quote: z.string().nullable() })).max(5),
  summary: z.string(),
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const ctx = await requireFounderOrService(req)
    const { reference_hire_id } = await req.json().catch(() => ({}))
    if (typeof reference_hire_id !== 'string') throw new HttpError(400, 'reference_hire_id is required')

    const { data: hire, error } = await ctx.admin
      .from('reference_hires')
      .select('id, name, role_title, reference_docs(id, extracted_text, is_readable)')
      .eq('id', reference_hire_id)
      .single()
    if (error || !hire) throw new HttpError(404, 'Reference hire not found')

    const docs = (hire.reference_docs ?? []).filter((d: { is_readable: boolean | null; extracted_text: string | null }) => d.is_readable && d.extracted_text)
    if (!docs.length) throw new HttpError(422, 'This hire has no readable document')

    // Redact each document, and record exactly what was sent.
    const redacted: string[] = []
    for (const doc of docs) {
      const r = redact(doc.extracted_text, { level: 'pattern', knownNames: [hire.name] })
      redacted.push(r.text)
      await ctx.admin.from('reference_docs').update({ redacted_text: r.text, redaction_counts: r.counts }).eq('id', doc.id)
    }
    const source = redacted.join('\n\n---\n\n')

    const { data, model } = await generateJson({
      system: SYSTEM,
      prompt: `Role hired into: ${hire.role_title}\n\nCV text:\n"""\n${source}\n"""`,
      jsonSchema,
      validator,
      temperature: 0.1,
    })

    // Enforce evidence: unverifiable quotes never survive as evidence.
    const warnings: string[] = []
    const role_expectations = data.role_expectations.map((e) => {
      if (e.verdict === 'not_evidenced') return { ...e, quote: null, quote_verified: false }
      if (quoteIsVerbatim(e.quote, source)) return { ...e, quote_verified: true }
      warnings.push(`Quote for "${e.expectation}" not found in CV; marked not evidenced.`)
      return { ...e, verdict: 'not_evidenced' as const, quote: null, quote_verified: false, reasoning: 'Not evidenced.' }
    })
    const stands_out = data.stands_out.filter((s) => {
      const ok = quoteIsVerbatim(s.quote, source)
      if (!ok) warnings.push(`Dropped "${s.point}": quote not found in CV.`)
      return ok
    })
    const gaps = data.gaps.map((g) => ({ ...g, quote: quoteIsVerbatim(g.quote, source) ? g.quote : null }))

    const bias_flags = findBiasTerms(
      [data.summary, ...role_expectations.map((e) => e.reasoning), ...stands_out.map((s) => s.point), ...gaps.map((g) => g.point)].join(' '),
    )

    const profile = {
      role_expectations,
      stands_out,
      gaps,
      summary: data.summary,
      warnings,
      bias_flags,
      role_expectations_source: 'Model general knowledge of the role (not from the CV)',
    }

    const { error: updateError } = await ctx.admin
      .from('reference_hires')
      .update({
        ai_profile: profile,
        ai_profile_model: model,
        ai_profile_prompt_version: PROMPT_VERSION,
        ai_profiled_at: new Date().toISOString(),
      })
      .eq('id', hire.id)
    if (updateError) throw new Error(updateError.message)

    await ctx.admin.from('audit_log').insert({
      actor: ctx.userId,
      action: 'reference_hire_profiled',
      entity: 'reference_hires',
      entity_id: hire.id,
      details: { model, prompt_version: PROMPT_VERSION, warnings: warnings.length, bias_flags },
    })

    return json({ ok: true, reference_hire_id: hire.id, model, profile })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    if (err instanceof GeminiError) return json({ error: err.message }, 502)
    console.error(err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
