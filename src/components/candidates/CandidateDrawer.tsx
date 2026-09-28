import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Loader2,
  Mail,
  MapPin,
  Pause,
  Phone,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AI_RECOMMENDATION,
  DECISION_LABEL,
  getCandidateDetail,
  recordDecision,
  regenerateBrief,
  signedCvUrl,
  type CandidateDetail,
  type Evaluation,
} from '@/lib/candidateDetail'
import { TIER_LABEL, type Tier } from '@/lib/candidates'
import { syncDraft } from '@/lib/emails'
import { cn } from '@/lib/utils'

const TIER_CLASS: Record<Tier, string> = {
  strong_fit: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  consider: 'border-amber-200 bg-amber-50 text-amber-900',
  below_threshold: 'border-slate-200 bg-slate-100 text-slate-700',
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b px-6 py-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Quote({ text }: { text: string | null }) {
  if (!text) return <p className="mt-1 text-xs italic text-muted-foreground">Not evidenced</p>
  return <blockquote className="mt-1 border-l-2 pl-3 text-xs text-muted-foreground">“{text}”</blockquote>
}

function Bar({ score, max }: { score: number; max: number }) {
  const pct = max ? Math.max(0, Math.min(100, (score / max) * 100)) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-muted" role="presentation">
      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  )
}

function SignalDots({ score }: { score: number }) {
  return (
    <span className="flex gap-1" aria-label={`${score} of 3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('size-2.5 rounded-full', i <= score ? 'bg-primary' : 'bg-muted-foreground/20')} />
      ))}
    </span>
  )
}

export function CandidateDrawer({
  candidateId,
  rankLabel,
  onClose,
  onChanged,
}: {
  candidateId: string | null
  rankLabel?: string
  onClose: () => void
  onChanged: () => void
}) {
  return (
    <Sheet open={!!candidateId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
        {candidateId && <DrawerBody key={candidateId} candidateId={candidateId} rankLabel={rankLabel} onChanged={onChanged} />}
      </SheetContent>
    </Sheet>
  )
}

function DrawerBody({ candidateId, rankLabel, onChanged }: { candidateId: string; rankLabel?: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [roleId, setRoleId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await getCandidateDetail(candidateId)
      setDetail(d)
      setRoleId((r) => r ?? d.applied_role_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load candidate')
    }
  }, [candidateId])
  useEffect(() => { load() }, [load])

  if (error) return <p role="alert" className="p-6 text-sm text-destructive">{error}</p>
  if (!detail) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <SheetTitle className="sr-only">Loading candidate</SheetTitle>
        <Skeleton className="h-8 w-64" /><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const byRole = new Map(detail.evaluations.map((e) => [e.role_id, e]))
  const applied = byRole.get(detail.applied_role_id)
  const ev = (roleId && byRole.get(roleId)) || applied
  const pii = detail.candidate_pii
  const recommended = detail.recommended_role_id && detail.recommended_role_id !== detail.applied_role_id
    ? detail.evaluations.find((e) => e.role_id === detail.recommended_role_id)?.roles
    : null

  return (
    <>
      <SheetHeader className="border-b px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SheetTitle className="truncate text-lg">{pii?.full_name ?? detail.display_label ?? 'Unnamed candidate'}</SheetTitle>
              {detail.is_demo && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">DEMO</Badge>}
            </div>
            <SheetDescription asChild>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {pii?.email && <a href={`mailto:${pii.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="size-3" aria-hidden />{pii.email}</a>}
                {pii?.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" aria-hidden />{pii.phone}</span>}
                {pii?.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{pii.location}</span>}
                {pii?.profile_urls?.map((u) => (
                  <a key={u} href={u.startsWith('http') ? u : `https://${u}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                    <LinkIcon className="size-3" aria-hidden />{u.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                ))}
              </div>
            </SheetDescription>
            <p className="mt-2 text-sm">
              Applied for <span className="font-medium">{applied?.roles.title ?? '—'}</span>
              {recommended && <> · <span className="font-medium text-primary">Recommended: {recommended.title}</span></>}
            </p>
          </div>
          {applied && (
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums leading-none">{applied.overall_score.toFixed(0)}</p>
              <Badge variant="outline" className={cn('mt-2', TIER_CLASS[applied.tier])}>{TIER_LABEL[applied.tier]}</Badge>
            </div>
          )}
        </div>
        {detail.evaluations.length > 1 && (
          <Tabs value={ev?.role_id} onValueChange={setRoleId} className="mt-3">
            <TabsList>
              {detail.evaluations.map((e) => (
                <TabsTrigger key={e.role_id} value={e.role_id}>
                  {e.roles.code} · {e.overall_score.toFixed(0)}{e.role_id === detail.applied_role_id ? ' (applied)' : ''}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {!ev ? (
          <p className="p-6 text-sm text-muted-foreground">This candidate hasn't been scored yet.</p>
        ) : (
          <>
            {ev.bias_flags.length > 0 && (
              <div className="flex items-start gap-2 border-b bg-red-50 px-6 py-3 text-sm text-red-800">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Bias check: the AI's reasoning mentions {ev.bias_flags.join(', ')}. Review the evidence before relying on it.
              </div>
            )}
            <WhyThisRank ev={ev} rankLabel={ev.role_id === detail.applied_role_id ? rankLabel : undefined} recommendedTitle={recommended?.title} />
            <AtsSection ev={ev} />
            <PatternSection ev={ev} />
            <StrengthsGaps ev={ev} />
            <InterviewBrief ev={ev} onRegenerated={load} />
            {detail.evaluations.length > 1 && <RoleComparison detail={detail} />}
            <CvViewer detail={detail} />
            <AuditFooter ev={ev} />
          </>
        )}
      </div>

      {applied && <DecisionBar detail={detail} applied={applied} onDecided={() => { load(); onChanged() }} />}
    </>
  )
}

function WhyThisRank({ ev, rankLabel, recommendedTitle }: { ev: Evaluation; rankLabel?: string; recommendedTitle?: string }) {
  const w = ev.weights_used
  const flags = ev.red_flags
  return (
    <Section title="Why this rank">
      <ul className="grid gap-2 text-sm">
        <li>
          <span className="font-medium">{TIER_LABEL[ev.tier]} for {ev.roles.title}</span>{rankLabel && ` · ${rankLabel}`}: overall {ev.overall_score.toFixed(0)} = ATS {ev.ats_score.toFixed(0)} × {Math.round(Number(w.ats_weight) * 100)}% + Pattern {ev.pattern_score.toFixed(0)} × {Math.round(Number(w.pattern_weight) * 100)}%.
        </li>
        {ev.summary && <li className="text-muted-foreground">{ev.summary}</li>}
        <li className={flags.length ? 'text-red-800' : 'text-muted-foreground'}>
          {flags.length ? `${flags.length} red flag${flags.length === 1 ? '' : 's'}: ${flags.map((f) => f.text).join('; ')}.` : 'No must-have gaps.'}
          {recommendedTitle && ` Scores 10+ points higher as ${recommendedTitle}.`}
        </li>
      </ul>
    </Section>
  )
}

function AtsSection({ ev }: { ev: Evaluation }) {
  const musts = ev.requirement_matches.filter((r) => r.kind === 'must_have')
  const nices = ev.requirement_matches.filter((r) => r.kind === 'nice_to_have')
  return (
    <Section title={`ATS breakdown · ${ev.ats_score.toFixed(0)}/100`}>
      <ul className="grid gap-4">
        {ev.ats_breakdown.map((c) => (
          <li key={c.key}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">{c.label}</span>
              <span className="tabular-nums text-muted-foreground">{c.score}/{c.max}</span>
            </div>
            <Bar score={c.score} max={c.max} />
            <p className="mt-1 text-xs text-muted-foreground">{c.explanation}</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {[['Must-haves', musts], ['Nice-to-haves', nices]].map(([label, items]) => (
          (items as typeof musts).length > 0 && (
            <div key={label as string}>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label as string}</h4>
              <ul className="grid gap-2.5">
                {(items as typeof musts).map((r) => (
                  <li key={r.id} className="text-sm">
                    <div className="flex items-start gap-2">
                      {r.credit === 1 ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-label="Met" />
                        : r.credit > 0 ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Partly met" />
                          : <XCircle className="mt-0.5 size-4 shrink-0 text-red-700" aria-label="Missing" />}
                      <div className="min-w-0">
                        <p>{r.text}</p>
                        {r.keyword_hit ? <p className="text-xs text-muted-foreground">Keyword found: “{r.keyword_hit}”</p> : <Quote text={r.quote} />}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        ))}
      </div>
    </Section>
  )
}

function PatternSection({ ev }: { ev: Evaluation }) {
  return (
    <Section title={`Pattern match · ${ev.pattern_score.toFixed(0)}/100`} aside={ev.success_patterns && <span className="text-xs text-muted-foreground">Pattern v{ev.success_patterns.version}</span>}>
      <ul className="grid gap-4">
        {ev.signal_scores.map((s) => (
          <li key={s.signal_id} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{s.name}</span>
              <span className="flex items-center gap-2 tabular-nums text-muted-foreground"><SignalDots score={s.score} /> {s.score}/3</span>
            </div>
            <Quote text={s.quote} />
            <p className="mt-1 text-xs text-muted-foreground">{s.reasoning}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function StrengthsGaps({ ev }: { ev: Evaluation }) {
  return (
    <Section title="Strengths and gaps">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-800">Strengths</h4>
          <ul className="grid gap-3">{ev.strengths.map((s, i) => <li key={i} className="text-sm">{s.point}<Quote text={s.quote} /></li>)}</ul>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-800">Gaps and risks</h4>
          <ul className="grid gap-3">{ev.gaps.map((g, i) => <li key={i} className="text-sm">{g.point}{g.quote && <Quote text={g.quote} />}</li>)}</ul>
        </div>
      </div>
    </Section>
  )
}

const TARGET_LABEL = { gap: 'Gap', red_flag: 'Red flag', signal: 'Signal' } as const

function InterviewBrief({ ev, onRegenerated }: { ev: Evaluation; onRegenerated: () => void }) {
  const [busy, setBusy] = useState(false)
  const brief = ev.interview_brief
  async function regen() {
    setBusy(true)
    try {
      await regenerateBrief(ev.id)
      toast.success('Interview brief updated')
      onRegenerated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate brief')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title="Interview brief"
      aside={
        <Button size="sm" variant="ghost" onClick={regen} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          {brief ? 'Regenerate' : 'Generate'}
        </Button>
      }
    >
      {!brief?.probes.length ? (
        <p className="text-sm text-muted-foreground">No brief yet for this role.</p>
      ) : (
        <ol className="grid gap-4">
          {brief.probes.map((p, i) => (
            <li key={i} className="rounded-md border p-3 text-sm">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium tabular-nums">{i + 1}.</span>
                <Badge variant="outline" className={p.target.type === 'signal' ? '' : 'border-amber-200 bg-amber-50 text-amber-900'}>
                  {TARGET_LABEL[p.target.type]}
                </Badge>
                <span className="text-muted-foreground">{p.target.label}{p.target.detail && ` (${p.target.detail})`}</span>
              </div>
              <p className="font-medium">{p.question}</p>
              <p className="mt-1.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">Listen for:</span> {p.listen_for}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

function RoleComparison({ detail }: { detail: CandidateDetail }) {
  return (
    <Section title="PM vs SPM">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">Role</th><th className="py-1.5 text-right font-medium">Overall</th>
              <th className="py-1.5 text-right font-medium">ATS</th><th className="py-1.5 text-right font-medium">Pattern</th>
              <th className="py-1.5 pl-3 font-medium">Tier</th><th className="py-1.5 text-right font-medium">Red flags</th>
              <th className="py-1.5 text-right font-medium">Experience fit</th>
            </tr>
          </thead>
          <tbody>
            {detail.evaluations.map((e) => (
              <tr key={e.role_id} className="border-t">
                <td className="py-2 font-medium">{e.roles.code}{e.role_id === detail.applied_role_id && <span className="ml-1 text-xs font-normal text-muted-foreground">(applied)</span>}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{e.overall_score.toFixed(0)}</td>
                <td className="py-2 text-right tabular-nums">{e.ats_score.toFixed(0)}</td>
                <td className="py-2 text-right tabular-nums">{e.pattern_score.toFixed(0)}</td>
                <td className="py-2 pl-3"><Badge variant="outline" className={TIER_CLASS[e.tier]}>{TIER_LABEL[e.tier]}</Badge></td>
                <td className="py-2 text-right tabular-nums">{e.red_flags.length}</td>
                <td className="py-2 text-right tabular-nums">{e.ats_breakdown.find((c) => c.key === 'experience')?.score ?? '—'}/25</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {detail.evaluations[0]?.years_product_experience ?? 0} years of product-management experience, counted from dated product-titled roles.
      </p>
    </Section>
  )
}

function CvViewer({ detail }: { detail: CandidateDetail }) {
  const file = detail.candidate_files[0]
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const isPdf = file?.mime_type === 'application/pdf'

  useEffect(() => {
    if (!open || !file || url) return
    signedCvUrl(file.storage_path).then(setUrl).catch((e) => toast.error(e.message))
  }, [open, file, url])

  if (!file) return null
  return (
    <Section
      title="Original CV"
      aside={
        <Button size="sm" variant="ghost" onClick={async () => {
          try { window.open(await signedCvUrl(file.storage_path), '_blank', 'noopener,noreferrer') } catch (e) { toast.error((e as Error).message) }
        }}>
          <ExternalLink className="size-4" aria-hidden /> Open file
        </Button>
      }
    >
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" aria-hidden /> {file.file_name}
        </summary>
        <div className="mt-3">
          {isPdf ? (
            url ? <iframe title={`CV: ${file.file_name}`} src={url} className="h-[70vh] w-full rounded-md border" />
              : <Skeleton className="h-[70vh] w-full" />
          ) : (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-sans text-xs">{file.extracted_text}</pre>
          )}
        </div>
      </details>
    </Section>
  )
}

function AuditFooter({ ev }: { ev: Evaluation }) {
  return (
    <p className="px-6 py-4 text-xs text-muted-foreground">
      Scored {new Date(ev.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} by {ev.model} ({ev.prompt_version})
      {ev.success_patterns && `, pattern v${ev.success_patterns.version}`}. Names, contact details, locations and colleges were removed before any AI step.
    </p>
  )
}

const DECISION_BUTTONS = [
  { value: 'move_forward', label: 'Move forward', icon: CheckCircle2, variant: 'default' },
  { value: 'hold', label: 'Hold', icon: Pause, variant: 'outline' },
  { value: 'pass', label: 'Pass', icon: XCircle, variant: 'outline' },
] as const

function DecisionBar({ detail, applied, onDecided }: { detail: CandidateDetail; applied: Evaluation; onDecided: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const suggestion = AI_RECOMMENDATION[applied.tier]
  const last = detail.decisions[0]

  async function decide(decision: (typeof DECISION_BUTTONS)[number]['value']) {
    setBusy(decision)
    try {
      await recordDecision(detail.id, decision, reason.trim())
      toast.success(`${DECISION_LABEL[decision]} recorded${decision !== suggestion ? ' (differs from AI suggestion)' : ''}`)
      setReason('')
      onDecided()
      // Draft (never send) the matching email; Hold discards any unsent draft.
      syncDraft(detail.id)
        .then((r) => {
          if (r.drafted) toast.message(`${r.type === 'invite' ? 'Invite' : 'Rejection'} draft ready in the Outbox. Nothing has been sent.`)
          else if (r.discarded) toast.message('Unsent draft discarded.')
        })
        .catch((e) => toast.error(`Decision saved, but the email draft failed: ${e.message}. Retry from the Outbox.`))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record decision')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="border-t bg-background px-6 py-4 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          AI suggests: <span className="font-medium text-foreground">{DECISION_LABEL[suggestion]}</span> ({TIER_LABEL[applied.tier]}). You decide.
        </span>
        {last && (
          <span>
            Current: <span className="font-medium text-foreground">{DECISION_LABEL[last.decision]}</span> on{' '}
            {new Date(last.decided_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
            {last.is_override && ' · override'}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Reason (optional)" placeholder="Reason (optional, saved to the decision log)" value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1" />
        <div className="flex gap-2">
          {DECISION_BUTTONS.map(({ value, label, icon: Icon, variant }) => (
            <Button key={value} variant={variant} disabled={busy !== null} onClick={() => decide(value)}
              className={cn(detail.decision_status === value && variant === 'outline' && 'border-primary bg-accent')}>
              {busy === value ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
              {label}
            </Button>
          ))}
        </div>
      </div>
      {applied.bias_flags.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-800"><AlertTriangle className="size-3.5" aria-hidden /> Bias check flagged this evaluation. Review it before deciding.</p>
      )}
    </div>
  )
}
