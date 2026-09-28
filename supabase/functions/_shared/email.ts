// Email drafting rules (Section 8 of the brief) and default templates.
// The model never sees the candidate's name or contact details: it writes with {{first_name}}
// placeholders, which are filled in here. Every draft is checked; anything that breaks a rule
// falls back to the founder's template.
import { z } from 'npm:zod@4.6.5'
import { generateJson } from './gemini.ts'

export const EMAIL_PROMPT_VERSION = 'email-draft/v1'
export type EmailType = 'invite' | 'rejection' | 'acknowledgement'

export const LIMITS: Record<EmailType, number> = { invite: 150, rejection: 120, acknowledgement: 120 }

export const DEFAULT_TEMPLATES: Record<EmailType, { subject: string; body: string }> = {
  invite: {
    subject: 'Interview for the {{role}} role at Kargo',
    body: `Hi {{first_name}},

Thank you for applying for the {{role}} role at Kargo. I read your application and would like to talk.

Please pick a time that suits you here: {{scheduling_link}}

Looking forward to it.`,
  },
  rejection: {
    subject: 'Your application for {{role}} at Kargo',
    body: `Hi {{first_name}},

Thank you for applying for the {{role}} role at Kargo, and for the time you put into it.

After reviewing your application carefully, we won't be moving forward with it. This was a considered decision, and I'm grateful you thought of Kargo.

I wish you the very best with your search.`,
  },
  acknowledgement: {
    subject: 'We received your application for {{role}}',
    body: `Hi {{first_name}},

Thank you for applying for the {{role}} role at Kargo. I've received your application and will get back to you personally.`,
  },
}

export const NO_LINK_LINE = 'Could you reply with two or three times over the next week that work for a 30-minute call?'

export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m))
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

/** Checks a body (before the signature is appended) against the content rules. */
export function checkRules(type: EmailType, body: string, opts: { hasLink: boolean; keepCvOnFile: boolean }): string[] {
  const problems: string[] = []
  const words = wordCount(body.replace(/\{\{\s*\w+\s*\}\}/g, 'x'))
  if (words > LIMITS[type]) problems.push(`${words} words (limit ${LIMITS[type]})`)
  if (/\b(score|scored|scoring|rank(ed|ing)?|tier|threshold|algorithm|AI|ATS)\b|\d+\s*%/i.test(body)) {
    problems.push('mentions scores, ranking or automated assessment')
  }
  if (type === 'rejection') {
    if (!opts.keepCvOnFile && /\b(on file|future (roles|opportunities|openings)|keep (your|you) in mind|reach out (again|in future))\b/i.test(body)) {
      problems.push('promises to keep the CV on file or future contact')
    }
    // Rejections must not dangle a next step.
    if (/\b(next steps?|(love|like) to (meet|talk|speak)|schedule a (call|chat))\b/i.test(body)) problems.push('suggests a next step')
  }
  if (type === 'invite') {
    if (opts.hasLink && !/\{\{\s*scheduling_link\s*\}\}/.test(body)) problems.push('missing the scheduling link')
    if (/\b(offer|salary|compensation|package)\b/i.test(body)) problems.push('mentions an offer or compensation')
  }
  if (/\{\{\s*(?!first_name|role|scheduling_link|founder_name)\w+\s*\}\}/.test(body)) problems.push('uses an unknown placeholder')
  return problems
}

const SYSTEM = `You draft short emails from the founder of Kargo (a Series A logistics SaaS company in Mumbai) to job applicants.

Rules you must follow:
- Write in the first person as the founder. Warm, plain, human. No corporate filler, no emojis, no exclamation marks.
- Start with "Hi {{first_name}}," exactly. Use {{role}} for the role name. Never invent a name.
- Do NOT write a sign-off or signature; it is added afterwards.
- Never mention scores, rankings, AI, automated screening, or any assessment details.
- Never mention salary, offers or compensation.
- Invite (max 130 words): thank them, reference ONE specific strength from the evidence provided (in your own words, briefly), and invite them to a first conversation. If told a scheduling link exists, include the placeholder {{scheduling_link}} on its own line. If not, ask them to reply with two or three times that work.
- Rejection (max 100 words): thank them sincerely, say clearly and kindly that you won't be moving forward, no false hope, no reasons that reveal assessment details. Only mention keeping their details for future roles if told that is allowed.`

const jsonSchema = {
  type: 'object',
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
  required: ['subject', 'body'],
}
const validator = z.object({ subject: z.string().min(5).max(120), body: z.string().min(40) })

export async function draftWithModel(input: {
  type: 'invite' | 'rejection'
  roleTitle: string
  strength: string | null
  hasLink: boolean
  keepCvOnFile: boolean
}): Promise<{ subject: string; body: string; model: string }> {
  const prompt = [
    `Email type: ${input.type}`,
    `Role: {{role}} (the ${input.roleTitle} role)`,
    input.type === 'invite'
      ? `Strength from their CV evidence: ${input.strength ?? '(none provided: keep it general and do not invent one)'}`
      : '',
    input.type === 'invite' ? `Scheduling link exists: ${input.hasLink ? 'yes' : 'no'}` : `Keeping their details for future roles is allowed: ${input.keepCvOnFile ? 'yes' : 'no'}`,
  ].filter(Boolean).join('\n')
  const { data, model } = await generateJson({ system: SYSTEM, prompt, jsonSchema, validator, temperature: 0.4 })
  return { ...data, model }
}
