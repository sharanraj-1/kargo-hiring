// Parses, redacts and scores ONE candidate against every role with a saved JD, using the approved pattern.
//
// 1. PII is detected without AI and stored in candidate_pii (founder only). If the name can't be
//    found, the candidate is flagged and NOTHING is sent to the model.
// 2. Two redacted copies are made: ATS text (PII removed) and pattern text (PII + institutions removed).
// 3. Two model calls run in parallel: structure/requirements/impact (ATS text), signals/strengths/gaps
//    (pattern text). Every quote is checked verbatim; unverifiable evidence scores zero.
// 4. All scores are computed deterministically in _shared/scoring.ts.
import { z } from 'npm:zod@4.6.5'
import { HttpError, requireFounderOrService } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import { buildAndStoreBrief } from '../_shared/brief.ts'
import { GeminiError, generateJson, quoteIsVerbatim } from '../_shared/gemini.ts'
import { detectPii } from '../_shared/pii.ts'
import { findBiasTerms, redact } from '../_shared/redact.ts'
import {
  clarity,
  creditFor,
  experienceFit,
  keywordHit,
  keywordMatch,
  overallScore,
  parsability,
  patternScore,
  productYears,
  quantifiedImpact,
  tierFor,
  type Component,
  type RequirementCredit,
  type Settings,
} from '../_shared/scoring.ts'

const ATS_PROMPT_VERSION = 'cv-ats/v1'
const PATTERN_PROMPT_VERSION = 'cv-pattern/v1'
const MIN_READABLE_CHARS = 300

// ---------------------------------------------------------------------------
// Call 1: structure, requirement matches, quantified impact (ATS text)
// ---------------------------------------------------------------------------
const ATS_SYSTEM = `You read a candidate's CV for Kargo, a Series A logistics SaaS company hiring product managers.

Rules you must follow:
1. Use ONLY the CV text. Never infer, assume or invent experience, dates or skills.
2. Every "quote" must be copied EXACTLY, character for character, from the CV: a contiguous phrase. No paraphrase.
3. If a requirement is not shown in the CV, status "not_evidenced" and quote null. "partial" means related but weaker or indirect evidence.
4. Tokens in square brackets such as [NAME], [EMAIL], [LOCATION] are redactions. Ignore them.
5. Never consider education institution, company brand or prestige, location, age or gender.
6. Dates: use "YYYY-MM". If only a year is written, use YYYY-01 for a start date and YYYY-12 for an end date. Use "present" for current roles. Use null if no date is written.
7. "quantified_bullets": bullets or sentences stating a measurable outcome (numbers, %, money, time saved, counts). Quote each exactly.`

const atsJsonSchema = {
  type: 'object',
  properties: {
    sections: {
      type: 'object',
      properties: {
        summary: { type: 'boolean' }, experience: { type: 'boolean' },
        education: { type: 'boolean' }, skills: { type: 'boolean' },
      },
      required: ['summary', 'experience', 'education', 'skills'],
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          company: { type: ['string', 'null'] },
          start: { type: ['string', 'null'] },
          end: { type: ['string', 'null'] },
        },
        required: ['title', 'company', 'start', 'end'],
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: { degree: { type: 'string' }, field: { type: ['string', 'null'] }, end_year: { type: ['integer', 'null'] } },
        required: ['degree', 'field', 'end_year'],
      },
    },
    skills: { type: 'array', items: { type: 'string' } },
    certifications: { type: 'array', items: { type: 'string' } },
    total_bullets: { type: 'integer' },
    quantified_bullets: { type: 'array', items: { type: 'object', properties: { quote: { type: 'string' } }, required: ['quote'] } },
    requirement_matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['met', 'partial', 'not_evidenced'] },
          quote: { type: ['string', 'null'] },
        },
        required: ['id', 'status', 'quote'],
      },
    },
  },
  required: ['sections', 'experience', 'education', 'skills', 'certifications', 'total_bullets', 'quantified_bullets', 'requirement_matches'],
}

const atsValidator = z.object({
  sections: z.object({ summary: z.boolean(), experience: z.boolean(), education: z.boolean(), skills: z.boolean() }),
  experience: z.array(z.object({ title: z.string(), company: z.string().nullable(), start: z.string().nullable(), end: z.string().nullable() })).max(30),
  education: z.array(z.object({ degree: z.string(), field: z.string().nullable(), end_year: z.number().int().nullable() })).max(10),
  skills: z.array(z.string()).max(80),
  certifications: z.array(z.string()).max(30),
  total_bullets: z.number().int().min(0),
  quantified_bullets: z.array(z.object({ quote: z.string() })).max(40),
  requirement_matches: z.array(z.object({ id: z.string(), status: z.enum(['met', 'partial', 'not_evidenced']), quote: z.string().nullable() })),
})

// ---------------------------------------------------------------------------
// Call 2: success signals, strengths, gaps (pattern text: no institutions)
// ---------------------------------------------------------------------------
const PATTERN_SYSTEM = `You assess a candidate's CV against Success Signals that Kargo's founder approved from past hires.

Scoring for each signal:
0 = not evidenced in the CV
1 = weak or indirect evidence
2 = clear evidence
3 = strong, specific evidence with concrete outcomes

Rules you must follow:
1. Use ONLY the CV text. Never infer or invent experience.
2. A score of 1 or more REQUIRES a "quote" copied EXACTLY, character for character, from the CV. If you cannot quote it, the score is 0 and the quote is null.
3. Tokens in square brackets such as [NAME], [LOCATION], [INSTITUTION] are redactions. Ignore them.
4. Never consider education institution, company brand or prestige, location, age or gender.
5. "strengths": exactly 3, each with an exact quote. "gaps": exactly 3 notable gaps or risks for a product role at Kargo; quote the CV if the gap is visible, otherwise null.
6. "summary": two or three plain sentences a busy founder can read in ten seconds. No scores, no flattery.`

const patternJsonSchema = {
  type: 'object',
  properties: {
    signal_scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'integer', enum: [0, 1, 2, 3] },
          quote: { type: ['string', 'null'] },
          reasoning: { type: 'string' },
        },
        required: ['id', 'score', 'quote', 'reasoning'],
      },
    },
    strengths: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, quote: { type: 'string' } }, required: ['point', 'quote'] } },
    gaps: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, quote: { type: ['string', 'null'] } }, required: ['point', 'quote'] } },
    summary: { type: 'string' },
  },
  required: ['signal_scores', 'strengths', 'gaps', 'summary'],
}

const patternValidator = z.object({
  signal_scores: z.array(z.object({ id: z.string(), score: z.number().int().min(0).max(3), quote: z.string().nullable(), reasoning: z.string() })),
  strengths: z.array(z.object({ point: z.string(), quote: z.string() })).max(6),
  gaps: z.array(z.object({ point: z.string(), quote: z.string().nullable() })).max(6),
  summary: z.string(),
})

type Req = { id: string; kind: string; text: string; synonyms: string[] }
type Jd = { id: string; role_id: string; years_required_min: number; years_required_max: number | null; jd_requirements: Req[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let candidateId: string | null = null
  let admin: Awaited<ReturnType<typeof requireFounderOrService>>['admin'] | null = null

  try {
    const ctx = await requireFounderOrService(req)
    admin = ctx.admin
    const body = await req.json().catch(() => ({}))
    if (typeof body.candidate_id !== 'string') throw new HttpError(400, 'candidate_id is required')
    candidateId = body.candidate_id

    // --- Load everything ----------------------------------------------------
    const [candRes, fileRes, piiRes, patternRes, rolesRes, settingsRes] = await Promise.all([
      admin.from('candidates').select('id, applied_role_id, status').eq('id', candidateId).single(),
      admin.from('candidate_files').select('extracted_text, text_chars').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('candidate_pii').select('full_name, other').eq('candidate_id', candidateId).maybeSingle(),
      admin.from('success_patterns').select('id, version, success_signals(id, name, description, observable_evidence, sort_order)').eq('status', 'approved').maybeSingle(),
      admin.from('roles').select('id, code, title, job_descriptions(id, role_id, status, version, years_required_min, years_required_max, jd_requirements(id, kind, text, synonyms))').eq('is_active', true).order('sort_order'),
      admin.from('settings').select('ats_weight, pattern_weight, strong_threshold, consider_threshold, recommend_role_delta').eq('id', 1).single(),
    ])
    if (candRes.error || !candRes.data) throw new HttpError(404, 'Candidate not found')
    if (!patternRes.data) throw new HttpError(409, 'No approved success pattern. Approve one before scoring.')
    if (settingsRes.error) throw new Error(settingsRes.error.message)
    const cand = candRes.data
    const settings = settingsRes.data as Settings
    const signals = [...(patternRes.data.success_signals ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    if (!signals.length) throw new HttpError(409, 'The approved pattern has no signals.')

    // Latest SAVED JD per role.
    const roles = (rolesRes.data ?? []).map((r) => {
      const saved = (r.job_descriptions ?? []).filter((j: { status: string }) => j.status === 'saved')
        .sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0] as Jd | undefined
      return { id: r.id, code: r.code as string, title: r.title as string, jd: saved }
    }).filter((r) => r.jd)
    if (!roles.length) throw new HttpError(409, 'No saved job descriptions. Save them before scoring.')
    if (!roles.some((r) => r.id === cand.applied_role_id)) {
      throw new HttpError(409, 'The applied role has no saved job description.')
    }

    const raw = fileRes.data?.extracted_text ?? ''
    if (raw.trim().length < MIN_READABLE_CHARS) {
      await admin.from('candidates').update({
        status: 'unreadable',
        text_chars: raw.trim().length,
        needs_attention: 'Unreadable – needs manual review',
      }).eq('id', candidateId)
      return json({ ok: false, status: 'unreadable' })
    }

    await admin.from('candidates').update({ processing_started_at: new Date().toISOString(), error_message: null }).eq('id', candidateId)

    // --- 1. PII -------------------------------------------------------------
    const detected = detectPii(raw)
    const founderName = piiRes.data?.other?.name_source === 'founder' ? piiRes.data.full_name : null
    const fullName = founderName ?? detected.full_name
    if (!fullName) {
      await admin.from('candidates').update({
        status: 'error',
        needs_attention: 'name_not_found',
        error_message: "Couldn't identify the candidate's name, so the CV can't be safely redacted. Enter the name to continue.",
      }).eq('id', candidateId)
      return json({ ok: false, status: 'needs_name' })
    }
    await admin.from('candidate_pii').upsert({
      candidate_id: candidateId,
      full_name: fullName,
      email: detected.email,
      phone: detected.phone,
      location: detected.location,
      profile_urls: detected.profile_urls,
      other: { name_source: founderName ? 'founder' : 'detected' },
    })

    // --- 2. Redaction -------------------------------------------------------
    const ats = redact(raw, { level: 'ats', knownNames: [fullName] })
    const pat = redact(raw, { level: 'pattern', knownNames: [fullName] })
    await admin.from('candidates').update({
      status: 'parsed',
      parsed_at: new Date().toISOString(),
      display_label: fullName,
      redacted_text: ats.text,
      pattern_text: pat.text,
      text_chars: raw.length,
    }).eq('id', candidateId)

    // --- 3. Model calls (parallel) -------------------------------------------
    const reqIndex = new Map<string, { role: (typeof roles)[number]; req: Req }>()
    const reqLines: string[] = []
    for (const role of roles) {
      const scored = role.jd!.jd_requirements.filter((q) => q.kind === 'must_have' || q.kind === 'nice_to_have')
      scored.forEach((q, i) => {
        const key = `${role.code}-${i + 1}`
        reqIndex.set(key, { role, req: q })
        reqLines.push(`${key} [${q.kind === 'must_have' ? 'must-have' : 'nice-to-have'}] ${q.text}`)
      })
    }
    const sigIndex = new Map(signals.map((s, i) => [`S${i + 1}`, s]))
    const sigLines = signals.map((s, i) => `S${i + 1}: ${s.name}\n  ${s.description}\n  Look for: ${s.observable_evidence}`)

    const [atsOut, patOut] = await Promise.all([
      generateJson({
        system: ATS_SYSTEM,
        prompt: `Requirements to check (give one requirement_matches entry for EVERY id):\n${reqLines.join('\n')}\n\nCV text:\n"""\n${ats.text}\n"""`,
        jsonSchema: atsJsonSchema,
        validator: atsValidator,
        temperature: 0.1,
      }),
      generateJson({
        system: PATTERN_SYSTEM,
        prompt: `Success Signals (give one signal_scores entry for EVERY id):\n${sigLines.join('\n')}\n\nCV text:\n"""\n${pat.text}\n"""`,
        jsonSchema: patternJsonSchema,
        validator: patternValidator,
        temperature: 0.1,
      }),
    ])
    const a = atsOut.data
    const p = patOut.data
    const today = new Date()

    // --- 4. Evidence checks ---------------------------------------------------
    const impactVerified = a.quantified_bullets.filter((b) => quoteIsVerbatim(b.quote, ats.text))
    const matchById = new Map(a.requirement_matches.map((m) => [m.id.trim(), m]))

    const signalResults = [...sigIndex.entries()].map(([key, s]) => {
      const m = p.signal_scores.find((x) => x.id.trim() === key)
      const verified = !!m && m.score > 0 && quoteIsVerbatim(m.quote, pat.text)
      return {
        signal_id: s.id,
        name: s.name,
        score: verified ? m!.score : 0,
        quote: verified ? m!.quote : null,
        quote_verified: verified,
        reasoning: verified ? m!.reasoning : m && m.score > 0 ? 'Not evidenced (quote could not be verified in the CV).' : (m?.reasoning ?? 'Not evidenced.'),
      }
    })
    const pScore = patternScore(signalResults.map((s) => s.score), signals.length)
    const strengths = p.strengths.filter((s) => quoteIsVerbatim(s.quote, pat.text)).slice(0, 3)
    const gaps = p.gaps.map((g) => ({ ...g, quote: quoteIsVerbatim(g.quote, pat.text) ? g.quote : null })).slice(0, 3)

    // --- 5. Deterministic scoring per role -------------------------------------
    const { years, roles: productRoles } = productYears(a.experience, today)
    const pii = { hasEmail: !!detected.email, hasPhone: !!detected.phone }
    const bias = findBiasTerms([p.summary, ...strengths.map((s) => s.point), ...gaps.map((g) => g.point), ...signalResults.map((s) => s.reasoning)].join(' '))

    const perRole = roles.map((role) => {
      const credits: RequirementCredit[] = [...reqIndex.entries()]
        .filter(([, v]) => v.role.id === role.id)
        .map(([key, { req: q }]) => {
          const m = matchById.get(key)
          const verified = !!m?.quote && quoteIsVerbatim(m.quote, ats.text)
          const hit = keywordHit(ats.text, q.synonyms ?? [])
          const status = m?.status ?? 'not_evidenced'
          return {
            id: q.id,
            kind: q.kind as 'must_have' | 'nice_to_have',
            text: q.text,
            keyword_hit: hit,
            ai_status: verified ? status : 'not_evidenced',
            quote: verified ? m!.quote : null,
            credit: creditFor(hit, status, verified),
          }
        })

      const components: Component[] = [
        parsability(a.sections, a.experience, today),
        keywordMatch(credits),
        experienceFit(years, Number(role.jd!.years_required_min), role.jd!.years_required_max === null ? null : Number(role.jd!.years_required_max), productRoles),
        quantifiedImpact(impactVerified.length, a.total_bullets),
        clarity({ ...pii, textChars: raw.length, totalBullets: a.total_bullets, entries: a.experience }),
      ]
      const atsScore = Math.round(components.reduce((s, c) => s + c.score, 0) * 10) / 10
      const overall = overallScore(atsScore, pScore, settings)

      const red_flags = [
        ...credits.filter((c) => c.kind === 'must_have' && c.credit === 0).map((c) => ({ type: 'must_have_gap', text: `Must-have not evidenced: ${c.text}` })),
        ...(years < Number(role.jd!.years_required_min)
          ? [{ type: 'experience_below', text: `${years} years of product experience; ${role.jd!.years_required_min}+ asked for` }]
          : []),
      ]
      return { role, credits, components, atsScore, overall, tier: tierFor(overall, settings), red_flags }
    })

    const applied = perRole.find((r) => r.role.id === cand.applied_role_id)!
    const best = perRole.reduce((b, r) => (r.overall > b.overall ? r : b), applied)
    const recommended = best.overall - applied.overall >= Number(settings.recommend_role_delta) ? best.role.id : cand.applied_role_id

    // --- 6. Persist -----------------------------------------------------------------
    await admin.from('evaluations').update({ is_current: false }).eq('candidate_id', candidateId).eq('is_current', true)

    const model = atsOut.model
    const evaluationIds = new Map<string, string>()
    for (const r of perRole) {
      const { data: ev, error: evErr } = await admin.from('evaluations').insert({
        candidate_id: candidateId,
        role_id: r.role.id,
        jd_id: r.role.jd!.id,
        pattern_id: patternRes.data.id,
        is_current: true,
        ats_score: r.atsScore,
        ats_breakdown: r.components,
        pattern_score: pScore,
        overall_score: r.overall,
        tier: r.tier,
        summary: p.summary,
        strengths,
        gaps,
        red_flags: r.red_flags,
        bias_flags: bias,
        requirement_matches: r.credits,
        signal_scores: signalResults,
        years_product_experience: years,
        recommended_role_id: r.role.id === cand.applied_role_id ? recommended : null,
        weights_used: settings,
        model,
        prompt_version: `${ATS_PROMPT_VERSION}+${PATTERN_PROMPT_VERSION}`,
        raw_output: { ats: a, pattern: p },
      }).select('id').single()
      if (evErr) throw new Error(evErr.message)
      evaluationIds.set(r.role.id, ev.id)

      const evidence = [
        ...r.components.map((c) => ({ kind: 'ats_component', ref_key: c.key, score: c.score, max_score: c.max, explanation: c.explanation })),
        ...r.credits.map((c) => ({
          kind: 'keyword', ref_key: c.id, score: c.credit, max_score: 1, quote: c.quote, quote_verified: !!c.quote,
          explanation: c.keyword_hit ? `Keyword match: "${c.keyword_hit}"` : c.quote ? `AI match (${c.ai_status})` : 'Not evidenced',
        })),
        ...impactVerified.map((b) => ({ kind: 'impact_bullet', quote: b.quote, quote_verified: true })),
        ...signalResults.map((s) => ({ kind: 'signal', ref_key: s.signal_id, score: s.score, max_score: 3, quote: s.quote, quote_verified: s.quote_verified, explanation: s.reasoning })),
        ...strengths.map((s) => ({ kind: 'strength', quote: s.quote, quote_verified: true, explanation: s.point })),
        ...gaps.map((g) => ({ kind: 'gap', quote: g.quote, quote_verified: !!g.quote, explanation: g.point })),
      ].map((e) => ({ ...e, evaluation_id: ev.id }))
      const { error: eErr } = await admin.from('evaluation_evidence').insert(evidence)
      if (eErr) throw new Error(eErr.message)
    }

    // Interview briefs for the applied role (and the recommended one, if different). Failures don't fail scoring.
    const briefRoles = [...new Set([cand.applied_role_id, recommended])]
    const briefs = await Promise.allSettled(briefRoles.map((rid) => buildAndStoreBrief(admin!, evaluationIds.get(rid)!)))
    const briefWarnings = briefs.flatMap((b) => (b.status === 'rejected' ? [`Interview brief failed: ${b.reason instanceof Error ? b.reason.message : b.reason}`] : b.value.warnings))

    await admin.from('candidates').update({
      status: 'scored',
      scored_at: new Date().toISOString(),
      recommended_role_id: recommended,
      needs_attention: null,
      error_message: null,
      structured_cv: { sections: a.sections, experience: a.experience, education: a.education, skills: a.skills, certifications: a.certifications },
    }).eq('id', candidateId)

    await admin.from('audit_log').insert({
      actor: ctx.userId,
      action: 'candidate_scored',
      entity: 'candidates',
      entity_id: candidateId,
      details: {
        model, prompt_version: `${ATS_PROMPT_VERSION}+${PATTERN_PROMPT_VERSION}`, pattern_version: patternRes.data.version,
        scores: Object.fromEntries(perRole.map((r) => [r.role.code, { ats: r.atsScore, pattern: pScore, overall: r.overall, tier: r.tier }])),
        bias_flags: bias,
      },
    })

    return json({
      ok: true,
      status: 'scored',
      candidate_id: candidateId,
      scores: Object.fromEntries(perRole.map((r) => [r.role.code, { ats: r.atsScore, pattern: pScore, overall: r.overall, tier: r.tier, red_flags: r.red_flags.length }])),
      recommended_role_id: recommended,
      years_product_experience: years,
      brief_warnings: briefWarnings,
    })
  } catch (err) {
    const message = err instanceof HttpError || err instanceof GeminiError ? err.message : 'Unexpected error while scoring'
    if (!(err instanceof HttpError)) console.error(err)
    // Record failures on the candidate (except auth/validation errors before we knew who it was).
    if (admin && candidateId && !(err instanceof HttpError && err.status < 409)) {
      await admin.from('candidates').update({ status: 'error', error_message: message }).eq('id', candidateId)
    }
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    if (err instanceof GeminiError) return json({ error: err.message }, 502)
    return json({ error: message }, 500)
  }
})
