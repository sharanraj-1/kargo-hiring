// Extracts structured requirements from a DRAFT job description for the founder to edit and save.
// Every requirement carries a verbatim quote from the JD; unverifiable ones are flagged, not silently kept.
// Location / relocation / work-mode requirements are routed to "not_scored" (location is excluded from scoring).
import { z } from 'npm:zod@4.6.5'
import { HttpError, requireFounderOrService } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { GeminiError, generateJson, quoteIsVerbatim } from '../_shared/gemini.ts'

const PROMPT_VERSION = 'jd-extract/v1'

const SYSTEM = `You extract hiring requirements from a job description so candidates' CVs can be checked against them.

Rules you must follow:
1. Use ONLY the job description text. Do not add requirements it does not state.
2. "source_quote" must be copied EXACTLY, character for character, from the JD: a contiguous phrase.
3. Classify each requirement:
   - "must_have": stated as required ("X years of", "experience with", "proven ability to", "evidence of").
   - "nice_to_have": stated as preferred ("ideally", "preferably", "a plus", "advantage").
   - "not_scored": location, relocation, in-office/remote, notice period, legal or visa conditions. These must never be used to score a candidate.
   If the JD's wording makes the category genuinely ambiguous (e.g. "an advantage, not a nice-to-have"), choose the closer one and explain in "note".
4. Do NOT list years of experience as a requirement; put the numeric range in years_required_min / years_required_max instead.
5. "keywords": 3 to 8 short words or phrases, all lower case, that would literally appear in a CV showing this requirement (include common synonyms). Empty for not_scored.
6. "responsibilities": what the role will own, from the JD's ownership / success sections, each with a quote.
7. Never include requirements about age, gender, college or company prestige, even if implied.`

const jsonSchema = {
  type: 'object',
  properties: {
    years_required_min: { type: ['number', 'null'] },
    years_required_max: { type: ['number', 'null'] },
    years_quote: { type: ['string', 'null'] },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['must_have', 'nice_to_have', 'not_scored'] },
          text: { type: 'string', description: 'The requirement in plain words, max 15 words.' },
          keywords: { type: 'array', items: { type: 'string' } },
          source_quote: { type: 'string' },
          note: { type: ['string', 'null'] },
        },
        required: ['kind', 'text', 'keywords', 'source_quote', 'note'],
      },
    },
    responsibilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, source_quote: { type: 'string' } },
        required: ['text', 'source_quote'],
      },
    },
  },
  required: ['years_required_min', 'years_required_max', 'years_quote', 'requirements', 'responsibilities'],
}

const validator = z.object({
  years_required_min: z.number().min(0).max(40).nullable(),
  years_required_max: z.number().min(0).max(40).nullable(),
  years_quote: z.string().nullable(),
  requirements: z.array(z.object({
    kind: z.enum(['must_have', 'nice_to_have', 'not_scored']),
    text: z.string().min(3),
    keywords: z.array(z.string()).max(12),
    source_quote: z.string(),
    note: z.string().nullable(),
  })).min(1).max(40),
  responsibilities: z.array(z.object({ text: z.string(), source_quote: z.string() })).max(20),
})

const LOCATION_TERMS = /\b(relocat\w*|in-office|in office|on-?site|remote|hybrid|based in|mumbai|bengaluru|bangalore|delhi|pune|hyderabad|chennai|visa|notice period)\b/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const ctx = await requireFounderOrService(req)
    const { jd_id } = await req.json().catch(() => ({}))
    if (typeof jd_id !== 'string') throw new HttpError(400, 'jd_id is required')

    const { data: jd, error } = await ctx.admin
      .from('job_descriptions')
      .select('id, status, source_text, role_id, roles(code, title)')
      .eq('id', jd_id)
      .single()
    if (error || !jd) throw new HttpError(404, 'Job description not found')
    if (jd.status !== 'draft') throw new HttpError(409, 'Only a draft job description can be re-extracted')
    const source = (jd.source_text ?? '').trim()
    if (source.length < 200) throw new HttpError(422, 'The job description text is too short to extract from')

    const role = Array.isArray(jd.roles) ? jd.roles[0] : jd.roles
    const { data, model } = await generateJson({
      system: SYSTEM,
      prompt: `Role: ${role?.title ?? 'Unknown'}\n\nJob description:\n"""\n${source}\n"""`,
      jsonSchema,
      validator,
      temperature: 0.1,
    })

    const warnings: string[] = []
    const rows = [
      ...data.requirements.map((r, i) => {
        let kind = r.kind
        let note = r.note
        // Policy guard: anything about location or work mode is never scored.
        if (kind !== 'not_scored' && LOCATION_TERMS.test(`${r.text} ${r.source_quote}`)) {
          kind = 'not_scored'
          note = 'Location / work-mode requirement: excluded from scoring by policy.'
          warnings.push(`Moved "${r.text}" to not scored (location / work mode).`)
        }
        const verified = quoteIsVerbatim(r.source_quote, source)
        if (!verified) warnings.push(`Quote for "${r.text}" not found verbatim in the JD. Check it before saving.`)
        return {
          jd_id: jd.id,
          kind,
          text: r.text,
          synonyms: kind === 'not_scored' ? [] : [...new Set(r.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))],
          source_quote: r.source_quote,
          quote_verified: verified,
          note,
          origin: 'ai',
          sort_order: i,
        }
      }),
      ...data.responsibilities.map((r, i) => {
        const verified = quoteIsVerbatim(r.source_quote, source)
        if (!verified) warnings.push(`Quote for responsibility "${r.text}" not found verbatim in the JD.`)
        return {
          jd_id: jd.id,
          kind: 'responsibility',
          text: r.text,
          synonyms: [],
          source_quote: r.source_quote,
          quote_verified: verified,
          note: null,
          origin: 'ai',
          sort_order: 100 + i,
        }
      }),
    ]

    if (data.years_required_min !== null && !quoteIsVerbatim(data.years_quote, source)) {
      warnings.push('Years of experience quote not found verbatim in the JD. Check the numbers before saving.')
    }

    // Replace any previous AI extraction on this draft; keep founder-added rows.
    const del = await ctx.admin.from('jd_requirements').delete().eq('jd_id', jd.id).eq('origin', 'ai')
    if (del.error) throw new Error(del.error.message)
    const ins = await ctx.admin.from('jd_requirements').insert(rows)
    if (ins.error) throw new Error(ins.error.message)

    const upd = await ctx.admin
      .from('job_descriptions')
      .update({
        years_required_min: data.years_required_min,
        years_required_max: data.years_required_max,
        extraction_raw: data,
        extraction_model: model,
        extraction_prompt_ver: PROMPT_VERSION,
        extracted_at: new Date().toISOString(),
        warnings,
      })
      .eq('id', jd.id)
    if (upd.error) throw new Error(upd.error.message)

    await ctx.admin.from('audit_log').insert({
      actor: ctx.userId,
      action: 'job_description_extracted',
      entity: 'job_descriptions',
      entity_id: jd.id,
      details: { model, prompt_version: PROMPT_VERSION, requirements: rows.length, warnings },
    })

    const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {})
    return json({ ok: true, jd_id: jd.id, model, counts, years: [data.years_required_min, data.years_required_max], warnings })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    if (err instanceof GeminiError) return json({ error: err.message }, 502)
    console.error(err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
