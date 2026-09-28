// Interview brief: 4–5 probe questions, each tied to a specific gap, red flag or success signal.
// Shared by score-candidate (generated at scoring time) and generate-interview-brief (regenerate / backfill).
import { z } from 'npm:zod@4.6.5'
import { generateJson } from './gemini.ts'
import { findBiasTerms } from './redact.ts'

export const BRIEF_PROMPT_VERSION = 'interview-brief/v1'

const SYSTEM = `You prepare a founder at Kargo (Series A logistics SaaS) for a first interview with a product management candidate.

Write 4 or 5 probe questions. Each question must:
1. Target exactly ONE item from the provided list by its id (a gap, red flag or success signal). Prefer gaps, red flags and weakly evidenced signals: the interview should test what the CV could not prove.
2. Ask for a specific past example, not a hypothetical opinion ("Tell me about a time…", "Walk me through…").
3. Be answerable in 3–5 minutes and be phrased as the founder would say it out loud.
4. Never ask about age, gender, family, marital status, religion, nationality, health, education institution, or where the candidate lives or comes from.

"listen_for": what a strong answer contains, in one sentence, so the founder can judge quickly.
Tokens in square brackets such as [NAME] or [INSTITUTION] are redactions; ignore them.`

const jsonSchema = {
  type: 'object',
  properties: {
    probes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target_id: { type: 'string' },
          question: { type: 'string' },
          why: { type: 'string', description: 'One sentence: what this tests and why it matters here.' },
          listen_for: { type: 'string' },
        },
        required: ['target_id', 'question', 'why', 'listen_for'],
      },
    },
  },
  required: ['probes'],
}

const validator = z.object({
  probes: z.array(z.object({ target_id: z.string(), question: z.string().min(10), why: z.string(), listen_for: z.string() })).min(3).max(6),
})

export type BriefTarget = { id: string; type: 'gap' | 'red_flag' | 'signal'; label: string; detail?: string }
export type Probe = { question: string; why: string; listen_for: string; target: BriefTarget }

export async function generateBrief(input: {
  roleTitle: string
  responsibilities: string[]
  cvText: string
  gaps: { point: string }[]
  redFlags: { text: string }[]
  signals: { name: string; score: number }[]
}): Promise<{ probes: Probe[]; warnings: string[]; model: string }> {
  const targets: BriefTarget[] = [
    ...input.gaps.map((g, i) => ({ id: `G${i + 1}`, type: 'gap' as const, label: g.point })),
    ...input.redFlags.map((f, i) => ({ id: `F${i + 1}`, type: 'red_flag' as const, label: f.text })),
    ...input.signals.map((s, i) => ({ id: `S${i + 1}`, type: 'signal' as const, label: s.name, detail: `scored ${s.score}/3` })),
  ]
  const byId = new Map(targets.map((t) => [t.id, t]))

  const { data, model } = await generateJson({
    system: SYSTEM,
    prompt: [
      `Role: ${input.roleTitle}`,
      `What the role owns:\n${input.responsibilities.map((r) => `- ${r}`).join('\n') || '- (not specified)'}`,
      `Items to target (use these ids):\n${targets.map((t) => `${t.id} [${t.type}] ${t.label}${t.detail ? ` (${t.detail})` : ''}`).join('\n')}`,
      `CV text:\n"""\n${input.cvText}\n"""`,
    ].join('\n\n'),
    jsonSchema,
    validator,
    temperature: 0.3,
  })

  const warnings: string[] = []
  const probes: Probe[] = []
  for (const p of data.probes) {
    const target = byId.get(p.target_id.trim())
    if (!target) { warnings.push(`Dropped a probe with unknown target ${p.target_id}.`); continue }
    const bias = findBiasTerms(p.question)
    if (bias.length) { warnings.push(`Dropped a probe that touched on: ${bias.join(', ')}.`); continue }
    probes.push({ question: p.question, why: p.why, listen_for: p.listen_for, target })
  }
  return { probes: probes.slice(0, 5), warnings, model }
}

/** Loads an evaluation's context, generates its brief and stores it on the evaluation. */
// deno-lint-ignore no-explicit-any
export async function buildAndStoreBrief(admin: any, evaluationId: string): Promise<{ probes: number; warnings: string[] }> {
  const { data: ev, error } = await admin
    .from('evaluations')
    .select('id, gaps, red_flags, signal_scores, jd_id, candidates(pattern_text), roles!evaluations_role_id_fkey(title)')
    .eq('id', evaluationId)
    .single()
  if (error || !ev) throw new Error('Evaluation not found')
  const cvText = ev.candidates?.pattern_text
  if (!cvText) throw new Error('Candidate has no redacted text')

  const { data: resp } = await admin.from('jd_requirements').select('text').eq('jd_id', ev.jd_id).eq('kind', 'responsibility')
  const result = await generateBrief({
    roleTitle: ev.roles?.title ?? 'Product Manager',
    responsibilities: (resp ?? []).map((r: { text: string }) => r.text),
    cvText,
    gaps: ev.gaps ?? [],
    redFlags: ev.red_flags ?? [],
    signals: (ev.signal_scores ?? []).map((s: { name: string; score: number }) => ({ name: s.name, score: s.score })),
  })
  const { error: upErr } = await admin
    .from('evaluations')
    .update({
      interview_brief: {
        probes: result.probes,
        warnings: result.warnings,
        model: result.model,
        prompt_version: BRIEF_PROMPT_VERSION,
        generated_at: new Date().toISOString(),
      },
    })
    .eq('id', evaluationId)
  if (upErr) throw new Error(upErr.message)
  return { probes: result.probes.length, warnings: result.warnings }
}
