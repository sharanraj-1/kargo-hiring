import { CheckCircle2, Circle, Inbox } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useOverview, type Kpis, type SetupStatus } from '@/hooks/useOverview'

const KPI_LABELS: { key: keyof Kpis; label: string; format: (v: number | null) => string }[] = [
  { key: 'totalApplicants', label: 'Total applicants', format: (v) => String(v ?? 0) },
  { key: 'scored', label: 'Scored', format: (v) => String(v ?? 0) },
  { key: 'awaitingDecision', label: 'Awaiting decision', format: (v) => String(v ?? 0) },
  { key: 'interviewsInvited', label: 'Interviews invited', format: (v) => String(v ?? 0) },
  { key: 'respondedPct', label: 'Candidates responded to', format: (v) => (v === null ? '—' : `${v}%`) },
  { key: 'avgDaysWaiting', label: 'Avg days waiting', format: (v) => (v === null ? '—' : String(v)) },
  { key: 'daysRolesOpen', label: 'Days roles open', format: (v) => (v === null ? 'Not set' : String(v)) },
]

const SETUP_STEPS: { key: keyof SetupStatus; label: string; to: string }[] = [
  { key: 'jdsSaved', label: 'Save job descriptions for every open role', to: '/job-descriptions' },
  { key: 'referenceDocsAdded', label: 'Add reference hire documents', to: '/reference-hires' },
  { key: 'patternApproved', label: 'Approve the success pattern', to: '/reference-hires' },
  { key: 'cvsUploaded', label: 'Upload candidate CVs', to: '/candidates' },
]

export function OverviewPage() {
  const { data, error } = useOverview()
  const setupDone = data && SETUP_STEPS.every((s) => data.setup[s.key])

  return (
    <>
      <PageHeader title="Overview" description="Where hiring stands today, and what needs your decision." />

      {error && (
        <p role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load overview: {error}
        </p>
      )}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {KPI_LABELS.map(({ key, label, format }) => (
          <Card key={key} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              {data ? (
                <p className="text-2xl font-semibold tabular-nums">{format(data.kpis[key])}</p>
              ) : (
                <Skeleton className="h-8 w-16" />
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="attention" className="lg:col-span-2">
          <h2 id="attention" className="mb-3 text-sm font-medium">Needs your attention</h2>
          <EmptyState
            icon={Inbox}
            title="Nothing needs your attention yet"
            description="Strong Fit candidates awaiting a decision, and anyone waiting longer than your response SLA, will appear here."
          />
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
                        <Link
                          to={step.to}
                          className="flex items-center gap-3 rounded-md px-2 py-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {done ? (
                            <CheckCircle2 className="size-4 shrink-0 text-emerald-700" aria-label="Done" />
                          ) : (
                            <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="To do" />
                          )}
                          <span className={done ? 'text-muted-foreground line-through' : ''}>
                            {i + 1}. {step.label}
                          </span>
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
    </>
  )
}
