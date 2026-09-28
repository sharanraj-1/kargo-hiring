import { AlertTriangle, CheckCircle2, Circle, Clock, Inbox, Star } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CandidateDrawer } from '@/components/candidates/CandidateDrawer'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useOverview, type AttentionItem, type Kpis, type SetupStatus } from '@/hooks/useOverview'

const num = (v: number | null) => (v === null ? '—' : String(v))
const KPI_LABELS: { key: keyof Kpis; label: string; format: (v: number | null) => string; hint?: string }[] = [
  { key: 'totalApplicants', label: 'Total applicants', format: (v) => String(v ?? 0) },
  { key: 'scored', label: 'Scored', format: (v) => String(v ?? 0) },
  { key: 'awaitingDecision', label: 'Awaiting decision', format: (v) => String(v ?? 0) },
  { key: 'interviewsInvited', label: 'Interviews invited', format: (v) => String(v ?? 0) },
  { key: 'respondedPct', label: 'Candidates responded to', format: (v) => (v === null ? '—' : `${v}%`), hint: 'Share of applicants who have been sent any email' },
  { key: 'avgDaysWaiting', label: 'Avg days waiting', format: num, hint: 'For applicants not yet emailed' },
  { key: 'avgDaysToDecision', label: 'Avg days to decision', format: num, hint: 'Application date to your decision' },
  { key: 'overrideRate', label: 'Override rate', format: (v) => (v === null ? '—' : `${v}%`), hint: 'How often you disagree with the AI suggestion' },
  { key: 'daysRolesOpen', label: 'Days roles open', format: (v) => (v === null ? 'Not set' : String(v)), hint: 'Set the open date per role in Settings' },
]

const SETUP_STEPS: { key: keyof SetupStatus; label: string; to: string }[] = [
  { key: 'jdsSaved', label: 'Save job descriptions for every open role', to: '/job-descriptions' },
  { key: 'referenceDocsAdded', label: 'Add reference hire documents', to: '/reference-hires' },
  { key: 'patternApproved', label: 'Approve the success pattern', to: '/reference-hires/pattern' },
  { key: 'cvsUploaded', label: 'Upload candidate CVs', to: '/candidates' },
]

const KIND = {
  strong_awaiting: { icon: Star, cls: 'text-emerald-700', label: 'Decide' },
  waiting: { icon: Clock, cls: 'text-red-700', label: 'Overdue' },
  action: { icon: AlertTriangle, cls: 'text-amber-700', label: 'Fix' },
} as const

export function OverviewPage() {
  const { data, error, reload } = useOverview()
  const [openId, setOpenId] = useState<string | null>(null)
  const setupDone = data && SETUP_STEPS.every((s) => data.setup[s.key])

  return (
    <>
      <PageHeader title="Overview" description="Where hiring stands today, and what needs your decision." />

      {error && (
        <p role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load overview: {error}
        </p>
      )}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {KPI_LABELS.map(({ key, label, format, hint }) => (
          <Card key={key} className="gap-2 py-4" title={hint}>
            <CardHeader className="px-4">
              <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              {data ? <p className="text-2xl font-semibold tabular-nums">{format(data.kpis[key])}</p> : <Skeleton className="h-8 w-16" />}
            </CardContent>
          </Card>
        ))}
      </section>
      <p className="mt-2 text-xs text-muted-foreground">Metrics exclude DEMO candidates.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="attention" className="lg:col-span-2">
          <h2 id="attention" className="mb-3 text-sm font-medium">Needs your attention</h2>
          {!data ? (
            <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
          ) : data.attention.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing needs your attention" description={`Strong Fit candidates awaiting a decision, and anyone waiting longer than ${data.slaDays} days, will appear here.`} />
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.attention.map((item) => <AttentionRow key={`${item.kind}-${item.id}`} item={item} onOpen={() => setOpenId(item.id)} />)}
            </ul>
          )}
        </section>

        {!setupDone && (
          <section aria-labelledby="setup">
            <h2 id="setup" className="mb-3 text-sm font-medium">Setup checklist</h2>
            <Card className="py-2">
              <CardContent className="px-2">
                <ol className="divide-y">
                  {SETUP_STEPS.map((step, i) => {
                    const done = data?.setup[step.key] ?? false
                    return (
                      <li key={step.key}>
                        <Link to={step.to} className="flex items-center gap-3 rounded-md px-2 py-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                          {done ? <CheckCircle2 className="size-4 shrink-0 text-emerald-700" aria-label="Done" /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="To do" />}
                          <span className={done ? 'text-muted-foreground line-through' : ''}>{i + 1}. {step.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ol>
              </CardContent>
            </Card>
          </section>
        )}
      </div>

      <CandidateDrawer candidateId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </>
  )
}

function AttentionRow({ item, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  const k = KIND[item.kind]
  const Icon = k.icon
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <Icon className={`size-4 shrink-0 ${k.cls}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{item.name}</span>
            {item.isDemo && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-800">DEMO</Badge>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
        </span>
        <span className={`text-xs font-medium ${k.cls}`}>{k.label}</span>
      </button>
    </li>
  )
}
