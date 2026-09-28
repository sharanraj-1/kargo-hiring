import { Download, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CandidateDrawer } from '@/components/candidates/CandidateDrawer'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ActivityLog } from '@/components/ActivityLog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DECISION_LABEL } from '@/lib/candidateDetail'
import { TIER_LABEL, type Tier } from '@/lib/candidates'
import { supabase } from '@/lib/supabase'

type Row = {
  id: string
  candidate_id: string
  decision: keyof typeof DECISION_LABEL
  ai_recommendation: keyof typeof DECISION_LABEL | null
  ai_tier: Tier | null
  is_override: boolean
  reason: string | null
  decided_at: string
  candidates: { display_label: string | null; is_demo: boolean; roles: { code: string } | null } | null
  evaluations: { overall_score: number | null } | null
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function toCsv(rows: Row[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['decided_at', 'candidate', 'demo', 'applied_role', 'overall_score', 'ai_tier', 'ai_recommendation', 'decision', 'override', 'reason']
  const lines = rows.map((r) => [
    r.decided_at, r.candidates?.display_label, r.candidates?.is_demo ? 'yes' : 'no', r.candidates?.roles?.code,
    r.evaluations?.overall_score, r.ai_tier ? TIER_LABEL[r.ai_tier] : '', r.ai_recommendation ? DECISION_LABEL[r.ai_recommendation] : '',
    DECISION_LABEL[r.decision], r.is_override ? 'yes' : 'no', r.reason,
  ].map(esc).join(','))
  return [header.join(','), ...lines].join('\n')
}

export function DecisionLogPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('decisions')
      .select(`id, candidate_id, decision, ai_recommendation, ai_tier, is_override, reason, decided_at,
        candidates(display_label, is_demo, roles!candidates_applied_role_id_fkey(code)),
        evaluations(overall_score)`)
      .order('decided_at', { ascending: false })
      .overrideTypes<Row[], { merge: false }>()
      .then(({ data, error }) => (error ? setError(error.message) : setRows(data ?? [])))
  }, [])

  const stats = useMemo(() => {
    const real = (rows ?? []).filter((r) => !r.candidates?.is_demo)
    const overrides = real.filter((r) => r.is_override).length
    return { total: real.length, overrides, rate: real.length ? Math.round((overrides / real.length) * 100) : null }
  }, [rows])

  function exportCsv() {
    if (!rows) return
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kargo-decision-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title="Decision log"
        description="Every decision, the AI recommendation it was made against, whether you overrode it, and your reasoning."
        actions={<Button variant="outline" onClick={exportCsv} disabled={!rows?.length}><Download className="size-4" aria-hidden /> Export CSV</Button>}
      />
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}

      <dl className="mb-6 grid grid-cols-3 gap-3 sm:max-w-xl">
        <div className="rounded-lg border px-4 py-3"><dt className="text-xs text-muted-foreground">Decisions</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{stats.total}</dd></div>
        <div className="rounded-lg border px-4 py-3"><dt className="text-xs text-muted-foreground">Overrides</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{stats.overrides}</dd></div>
        <div className="rounded-lg border px-4 py-3">
          <dt className="text-xs text-muted-foreground">Override rate</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{stats.rate === null ? '—' : `${stats.rate}%`}</dd>
        </div>
      </dl>
      <p className="-mt-3 mb-6 max-w-2xl text-xs text-muted-foreground">
        Override rate = how often your decision differs from the AI's suggestion (Strong Fit → Move forward, Consider → Hold, Below Threshold → Pass).
        A trust metric: consistently high means the scoring doesn't match your judgement and the pattern or JDs need revisiting. DEMO decisions are excluded.
      </p>

      <Tabs defaultValue="decisions">
        <TabsList className="mb-4">
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
          <TabsTrigger value="activity">All activity</TabsTrigger>
        </TabsList>
        <TabsContent value="activity"><ActivityLog /></TabsContent>
        <TabsContent value="decisions">
      {rows === null && !error ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : rows && rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No decisions logged" description="Decisions you make on candidates are recorded here with a timestamp and optional reason." />
      ) : rows ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead><TableHead>Candidate</TableHead><TableHead>Role</TableHead>
                <TableHead className="text-right">Score</TableHead><TableHead>AI recommendation</TableHead>
                <TableHead>Your decision</TableHead><TableHead>Override</TableHead><TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(r.decided_at)}</TableCell>
                  <TableCell>
                    <button type="button" className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setOpenId(r.candidate_id)}>
                      {r.candidates?.display_label ?? 'Candidate'}
                    </button>
                    {r.candidates?.is_demo && <Badge variant="outline" className="ml-2 border-violet-200 bg-violet-50 text-[10px] text-violet-800">DEMO</Badge>}
                  </TableCell>
                  <TableCell>{r.candidates?.roles?.code ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.evaluations?.overall_score?.toFixed(0) ?? '—'}</TableCell>
                  <TableCell>{r.ai_recommendation ? DECISION_LABEL[r.ai_recommendation] : '—'}{r.ai_tier && <span className="text-muted-foreground"> ({TIER_LABEL[r.ai_tier]})</span>}</TableCell>
                  <TableCell className="font-medium">{DECISION_LABEL[r.decision]}</TableCell>
                  <TableCell>{r.is_override ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">Override</Badge> : <span className="text-muted-foreground">Agreed</span>}</TableCell>
                  <TableCell className="max-w-72 truncate" title={r.reason ?? ''}>{r.reason ?? <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
        </TabsContent>
      </Tabs>

      <CandidateDrawer candidateId={openId} onClose={() => setOpenId(null)} onChanged={() => {}} />
    </>
  )
}
