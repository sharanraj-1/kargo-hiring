// Extracts a DRAFT success pattern (5–8 Success Signals) by contrasting positive reference
// hires with neutral/negative ones. The draft cannot score anyone until the founder approves it.
//
// - Hires are sent as anonymous labels (H1, H2…) with PII- and institution-redacted text.
// - Product-role hires are marked as higher weight (strongest contrast for PM/SPM).
// - Every supporting quote must appear verbatim in that hire's redacted text; unverifiable
//   quotes are dropped, and a signal with no verified quote from a positive hire is dropped.
// - Signal wording is checked for bias terms (college, prestige, location, age, gender).
import { z } from 'npm:zod@4.6.5'
import { HttpError, requireFounderOrService } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { findBiasTerms, redact } from '../_shared/redact.ts'
import { GeminiError, generateJson, quoteIsVerbatim } from '../_shared/gemini.ts'

const PROMPT_VERSION = 'success-pattern/v1'

const SYSTEM = `You help the founder of Kargo, a Series A logistics SaaS company, understand what their best hires have in common, so that future Product Manager (PM) and Senior Product Manager (SPM) candidates can be assessed against it.

You receive past hires labelled H1, H2, … Each has a reference type:
- POSITIVE: rated "Exceeds expectations" and still at Kargo.
- NEUTRAL: rated "Meets expectations".
- NEGATIVE: rated "Below expectations", or left / was let go.
Hires marked "weight: HIGH (product role)" are the most relevant contrast for PM/SPM; give their differences the most weight.

Task: identify 5 to 8 Success Signals that distinguish POSITIVE hires from NEUTRAL/NEGATIVE ones and that would transfer to a PM/SPM role.

Rules you must follow:
1. A signal must be an observable behaviour or experience visible in a CV (e.g. "has owned an operational workflow end to end"). Never a demographic, education institution, company brand or prestige, location, age, gender, or personality label.
2. Support each signal with quotes copied EXACTLY, character for character, from the named hire's text. Contiguous text only; no paraphrase. Only quote hires whose text actually shows the signal.
3. List in "absent_in" the NEUTRAL/NEGATIVE (and any POSITIVE) hires whose text does not show it, with a short note.
4. Never invent or infer experience that is not written in the text. If the evidence is thin, say so and lower the confidence.
5. Tokens in square brackets such as [NAME], [LOCATION], [INSTITUTION] are redactions. Ignore them.
6. Confidence: "high" only if the signal is clearly present in most positive hires, clearly weaker or absent in the neutral/negative ones, and holds for the product-role contrast. Otherwise "medium" or "low". The sample is small; be conservative.
7. "observable_evidence" must tell a reviewer exactly what to look for in a candidate's CV.`

const jsonSchema = {
  type: 'object',
  properties: {
    signals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short name, max 8 words.' },
          description: { type: 'string', description: 'One or two sentences.' },
          observable_evidence: { type: 'string', description: 'What in a CV would indicate this signal.' },
          present_in: {
            type: 'array',
            items: {
              type: 'object',
              properties: { hire: { type: 'string' }, quote: { type: 'string' } },
              required: ['hire', 'quote'],
            },
          },
          absent_in: {
            type: 'array',
            items: {
              type: 'object',
              properties: { hire: { type: 'string' }, note: { type: 'string' } },
              required: ['hire', 'note'],
            },
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          confidence_rationale: { type: 'string', description: 'One sentence.' },
        },
        required: ['name', 'description', 'observable_evidence', 'present_in', 'absent_in', 'confidence', 'confidence_rationale'],
      },
    },
    caveats: { type: 'string', description: 'Limitations of this analysis, in one or two sentences.' },
  },
  required: ['signals', 'caveats'],
}

const validator = z.object({
  signals: z
    .array(z.object({
      name: z.string().min(3),
      description: z.string().min(10),
      observable_evidence: z.string().min(10),
      present_in: z.array(z.object({ hire: z.string(), quote: z.string() })),
      absent_in: z.array(z.object({ hire: z.string(), note: z.string() })),
      confidence: z.enum(['high', 'medium', 'low']),
      confidence_rationale: z.string(),
    }))
    .min(3)
    .max(10),
  caveats: z.string(),
})

type Hire = {
  id: string
  name: string
  role_title: string
  last_rating: string
  reference_type: 'positive' | 'neutral' | 'negative'
  is_product_role: boolean
  application_standout: string | null
  interview_revealed: string | null
  outcome_note: string | null
  reference_docs: { id: string; extracted_text: string | null; is_readable: boolean | null }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const ctx = await requireFounderOrService(req)

    const { data: rows, error } = await ctx.admin
      .from('reference_hires')
      .select(`id, name, role_title, last_rating, reference_type, is_product_role,
        application_standout, interview_revealed, outcome_note,
        reference_docs(id, extracted_text, is_readable)`)
      .neq('reference_type', 'unclassified')
      .order('joined_on')
      .returns<Hire[]>()
    if (error) throw new Error(error.message)

    const allNames = (rows ?? []).map((h) => h.name)
    const hires = (rows ?? [])
      .map((h) => ({ ...h, docs: h.reference_docs.filter((d) => d.is_readable && d.extracted_text) }))
      .filter((h) => h.docs.length > 0)

    const positives = hires.filter((h) => h.reference_type === 'positive')
    const contrast = hires.filter((h) => h.reference_type !== 'positive')
    if (!positives.length || !contrast.length) {
      throw new HttpError(422, 'Needs at least one positive and one neutral or negative hire with a readable document.')
    }

    // Label, redact (all hire names are known, so redact every one of them everywhere).
    const labelled = hires.map((h, i) => {
      const label = `H${i + 1}`
      const cv = h.docs
        .map((d) => redact(d.extracted_text!, { level: 'pattern', knownNames: allNames }).text)
        .join('\n\n---\n\n')
      const notes = [
        h.application_standout && `What stood out in their application (founder): ${h.application_standout}`,
        h.interview_revealed && `What the interview revealed (founder): ${h.interview_revealed}`,
        h.outcome_note && `Outcome note (founder): ${h.outcome_note}`,
      ]
        .filter(Boolean)
        .map((n) => redact(n as string, { level: 'pattern', knownNames: allNames }).text)
        .join('\n')
      return { hire: h, label, source: [cv, notes].filter(Boolean).join('\n\n') }
    })
    const byLabel = new Map(labelled.map((l) => [l.label, l]))

    const prompt = labelled
      .map(({ hire, label, source }) =>
        [
          `### ${label}`,
          `Role: ${hire.role_title}`,
          `Reference type: ${hire.reference_type.toUpperCase()} (last rating: ${hire.last_rating})`,
          `Weight: ${hire.is_product_role ? 'HIGH (product role)' : 'normal'}`,
          `Text:\n"""\n${source}\n"""`,
        ].join('\n'),
      )
      .join('\n\n')

    const { data, model } = await generateJson({
      system: SYSTEM,
      prompt,
      jsonSchema,
      validator,
      temperature: 0.2,
      timeoutMs: 140_000,
    })

    // Verify evidence and map labels back to hires.
    const warnings: string[] = []
    const signals = data.signals.flatMap((s) => {
      const quotes = s.present_in.flatMap((p) => {
        const l = byLabel.get(p.hire.trim())
        if (!l) {
          warnings.push(`"${s.name}": unknown hire label ${p.hire}; quote dropped.`)
          return []
        }
        if (!quoteIsVerbatim(p.quote, l.source)) {
          warnings.push(`"${s.name}": quote attributed to ${l.hire.name} not found verbatim; dropped.`)
          return []
        }
        return [{ reference_hire_id: l.hire.id, hire_name: l.hire.name, reference_type: l.hire.reference_type, quote: p.quote }]
      })
      if (!quotes.some((q) => q.reference_type === 'positive')) {
        warnings.push(`Dropped signal "${s.name}": no verified quote from a positive hire.`)
        return []
      }
      const counter = s.absent_in.flatMap((a) => {
        const l = byLabel.get(a.hire.trim())
        return l ? [{ reference_hire_id: l.hire.id, hire_name: l.hire.name, reference_type: l.hire.reference_type, note: a.note }] : []
      })
      const bias = findBiasTerms([s.name, s.description, s.observable_evidence].join(' '))
      return [{ ...s, quotes, counter, bias }]
    })

    if (signals.length < 5) warnings.push(`Only ${signals.length} signal(s) survived evidence checks (target 5–8). Review carefully or add your own.`)
    if (!signals.length) throw new HttpError(422, `No signal could be backed by verified quotes. ${warnings.join(' ')}`)

    // New draft version.
    const { data: last } = await ctx.admin
      .from('success_patterns')
      .select('version')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    const version = (last?.version ?? 0) + 1

    const { data: pattern, error: patternError } = await ctx.admin
      .from('success_patterns')
      .insert({
        version,
        status: 'draft',
        sample_size: hires.length,
        reference_hire_ids: hires.map((h) => h.id),
        model,
        prompt_version: PROMPT_VERSION,
        raw_output: data,
        generated_at: new Date().toISOString(),
        notes: data.caveats,
        warnings,
      })
      .select('id, version')
      .single()
    if (patternError) throw new Error(patternError.message)

    const { error: signalsError } = await ctx.admin.from('success_signals').insert(
      signals.map((s, i) => ({
        pattern_id: pattern.id,
        name: s.name,
        description: s.description,
        observable_evidence: s.observable_evidence,
        reference_quotes: s.quotes,
        counter_examples: s.counter,
        confidence: s.confidence,
        confidence_rationale: s.confidence_rationale,
        bias_flags: s.bias,
        origin: 'ai',
        sort_order: i,
      })),
    )
    if (signalsError) throw new Error(signalsError.message)

    await ctx.admin.from('audit_log').insert({
      actor: ctx.userId,
      action: 'success_pattern_extracted',
      entity: 'success_patterns',
      entity_id: pattern.id,
      details: { version, model, prompt_version: PROMPT_VERSION, sample_size: hires.length, signals: signals.length, warnings },
    })

    return json({ ok: true, pattern_id: pattern.id, version, sample_size: hires.length, signals: signals.length, warnings })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    if (err instanceof GeminiError) return json({ error: err.message }, 502)
    console.error(err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
