// Creates (or replaces) the unsent email draft that matches a candidate's latest decision.
//   move_forward -> invite draft, pass -> rejection draft, hold/awaiting -> discard unsent drafts.
// Never sends anything. Sending is a separate, founder-only click (send-email).
import { HttpError, requireFounderOrService } from '../_shared/auth.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  checkRules,
  DEFAULT_TEMPLATES,
  draftWithModel,
  EMAIL_PROMPT_VERSION,
  fillTemplate,
  NO_LINK_LINE,
  type EmailType,
} from '../_shared/email.ts'
import { GeminiError } from '../_shared/gemini.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const ctx = await requireFounderOrService(req)
    const { candidate_id } = await req.json().catch(() => ({}))
    if (typeof candidate_id !== 'string') throw new HttpError(400, 'candidate_id is required')
    const admin = ctx.admin

    const [candRes, piiRes, settingsRes, decRes] = await Promise.all([
      admin.from('candidates').select('id, decision_status, applied_role_id, roles!candidates_applied_role_id_fkey(title)').eq('id', candidate_id).single(),
      admin.from('candidate_pii').select('full_name, email').eq('candidate_id', candidate_id).maybeSingle(),
      admin.from('settings').select('founder_name, signature, scheduling_link, keep_cv_on_file, templates, email_drafting').eq('id', 1).single(),
      admin.from('decisions').select('id').eq('candidate_id', candidate_id).order('decided_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (candRes.error || !candRes.data) throw new HttpError(404, 'Candidate not found')
    const cand = candRes.data
    const settings = settingsRes.data!

    const type: EmailType | null =
      cand.decision_status === 'move_forward' ? 'invite' : cand.decision_status === 'pass' ? 'rejection' : null

    // Decision changed or on hold: discard unsent drafts of any other type.
    const { data: unsent } = await admin.from('emails').select('id, type').eq('candidate_id', candidate_id).in('status', ['draft', 'failed'])
    const stale = (unsent ?? []).filter((e) => e.type !== type && e.type !== 'acknowledgement').map((e) => e.id)
    if (stale.length) await admin.from('emails').delete().in('id', stale)
    if (!type) return json({ ok: true, drafted: false, discarded: stale.length })

    // Already sent this type? Don't draft a second one.
    const { count: sentCount } = await admin.from('emails').select('id', { count: 'exact', head: true })
      .eq('candidate_id', candidate_id).eq('type', type).in('status', ['sent', 'sending'])
    if (sentCount) return json({ ok: true, drafted: false, reason: `A ${type} has already been sent`, discarded: stale.length })

    // Evidence for the invite: the first verified strength (redacted text, no PII).
    const { data: ev } = await admin.from('evaluations').select('strengths')
      .eq('candidate_id', candidate_id).eq('role_id', cand.applied_role_id).eq('is_current', true).maybeSingle()
    const strength = (ev?.strengths as { point: string }[] | null)?.[0]?.point ?? null

    const roleTitle = (Array.isArray(cand.roles) ? cand.roles[0] : cand.roles)?.title ?? 'open'
    const hasLink = !!settings.scheduling_link
    const firstName = (piiRes.data?.full_name ?? '').trim().split(/\s+/)[0] || 'there'
    const vars = {
      first_name: firstName,
      role: roleTitle,
      scheduling_link: settings.scheduling_link ?? '',
      founder_name: settings.founder_name ?? '',
    }

    const warnings: string[] = []
    let subject: string
    let body: string
    let generatedBy: string
    try {
      if (settings.email_drafting === 'template') throw new Error('Template mode is on in Settings')
      const out = await draftWithModel({ type, roleTitle, strength, hasLink, keepCvOnFile: settings.keep_cv_on_file })
      const problems = checkRules(type, out.body, { hasLink, keepCvOnFile: settings.keep_cv_on_file })
      if (problems.length) throw new Error(`AI draft broke the content rules (${problems.join('; ')})`)
      subject = out.subject
      body = out.body
      generatedBy = out.model
    } catch (err) {
      if (settings.email_drafting !== 'template') warnings.push(`${err instanceof Error ? err.message : 'AI draft failed'}. Used your template instead.`)
      const tpl = (settings.templates as Record<string, { subject: string; body: string }>)?.[type] ?? DEFAULT_TEMPLATES[type]
      subject = tpl.subject
      body = type === 'invite' && !hasLink ? tpl.body.replace(/.*\{\{\s*scheduling_link\s*\}\}.*/, NO_LINK_LINE) : tpl.body
      generatedBy = 'template'
    }

    const signature = (settings.signature ?? settings.founder_name ?? '').trim()
    const finalBody = `${fillTemplate(body.trim(), vars)}${signature ? `\n\n${signature}` : ''}`
    if (!piiRes.data?.email) warnings.push('No email address was found in the CV. Add the recipient before sending.')

    // Replace an existing unsent draft of the same type.
    await admin.from('emails').delete().eq('candidate_id', candidate_id).eq('type', type).in('status', ['draft', 'failed'])
    const { data: email, error: insErr } = await admin.from('emails').insert({
      candidate_id,
      type,
      status: 'draft',
      to_email: piiRes.data?.email ?? null,
      subject: fillTemplate(subject, vars),
      body: finalBody,
      generated_by: generatedBy,
      warnings,
      decision_id: decRes.data?.id ?? null,
    }).select('id').single()
    if (insErr) throw new Error(insErr.message)

    await admin.from('audit_log').insert({
      actor: ctx.userId, action: 'email_drafted', entity: 'emails', entity_id: email.id,
      details: { candidate_id, type, generated_by: generatedBy, prompt_version: EMAIL_PROMPT_VERSION, warnings },
    })
    return json({ ok: true, drafted: true, email_id: email.id, type, generated_by: generatedBy, warnings, discarded: stale.length })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    if (err instanceof GeminiError) return json({ error: err.message }, 502)
    console.error(err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
