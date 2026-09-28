import { ListChecks, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CandidateDrawer } from '@/components/candidates/CandidateDrawer'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { recordBulkPass } from '@/lib/candidateDetail'
import { syncDrafts } from '@/lib/emails'
import { daysWaiting, listCandidates, listRoles, type CandidateRow, type Role } from '@/lib/candidates'
import { supabase } from '@/lib/supabase'

type Item = { c: CandidateRow; name: string; role: Role | undefined; overall: number; ats: number; pattern: number; reason: string }

/** One-line reason, from the evaluation's own evidence: first red flag, else the weakest ATS component, else the first gap. */
async function reasonsFor(evaluationIds: string[]): Promise<Map<string, string>> {
  if (!evaluationIds.length) return new Map()
  const { data } = await supabase.from('evaluations').select('id, red_flags, ats_breakdown, gaps, pattern_score').in('id', evaluationIds)
  const out = new Map<string, string>()
  for (const e of data ?? []) {
    const flag = (e.red_flags as { text: string }[] | null)?.[0]?.text
    const weakest = [...((e.ats_breakdown as { label: string; score: number; max: number; explanation: string }[] | null) ?? [])]
      .sort((a, b) => a.score / a.max - b.score / b.max)[0]
    const gap = (e.gaps as { point: string }[] | null)?.[0]?.point
    const pattern = Number(e.pattern_score)
    out.set(e.id, flag ?? (pattern < 34 ? `Few success signals evidenced (pattern ${pattern.toFixed(0)}/100)` : weakest ? `${weakest.label}: ${weakest.explanation}` : gap ?? 'Low overall score'))
  }
  return out
}

export function BelowThresholdPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [cands, roles] = await Promise.all([listCandidates(), listRoles()])
      const byRole = new Map(roles.map((r) => [r.id, r]))
      const below = cands
        .map((c) => ({ c, ev: c.evaluations.find((e) => e.role_id === c.applied_role_id) }))
        .filter(({ c, ev }) => c.status === 'scored' && c.decision_status === 'awaiting' && ev?.tier === 'below_threshold')
      const reasons = await reasonsFor(below.map((b) => b.ev!.id))
      setItems(
        below
          .map(({ c, ev }) => ({
            c,
            name: c.display_label ?? c.candidate_files[0]?.file_name ?? 'Unnamed',
            role: byRole.get(c.applied_role_id),
            overall: Number(ev!.overall_score),
            ats: Number(ev!.ats_score),
            pattern: Number(ev!.pattern_score),
            reason: reasons.get(ev!.id) ?? '',
          }))
          .sort((a, b) => a.overall - b.overall),
      )
      setSelected((s) => new Set([...s].filter((id) => below.some((b) => b.c.id === id))))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const allSelected = !!items?.length && selected.size === items.length
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectedItems = useMemo(() => items?.filter((i) => selected.has(i.c.id)) ?? [], [items, selected])

  async function confirmPass() {
    setBusy(true)
    try {
      const ids = [...selected]
      const n = await recordBulkPass(ids, reason.trim())
      toast.success(`Pass recorded for ${n} candidate${n === 1 ? '' : 's'}. No emails have been sent.`)
      setConfirm(false)
      setReason('')
      setSelected(new Set())
      load()
      const t = toast.loading(`Drafting rejection emails 0/${ids.length}…`)
      const r = await syncDrafts(ids, (d) => toast.loading(`Drafting rejection emails ${d}/${ids.length}…`, { id: t }))
      toast.success(`${r.drafted} rejection draft${r.drafted === 1 ? '' : 's'} ready in the Outbox for your review${r.failed ? ` (${r.failed} failed, retry from the Outbox)` : ''}.`, { id: t })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record decisions')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Review below threshold"
        description="Candidates scoring below the threshold who are still awaiting your decision. Nobody here is rejected or emailed until you confirm; rejection emails are drafted only after that, and sent only when you click Send."
        actions={
          <Button disabled={selected.size === 0} onClick={() => setConfirm(true)}>
            <XCircle className="size-4" aria-hidden /> Confirm Pass for selected{selected.size ? ` (${selected.size})` : ''}
          </Button>
        }
      />
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}

      {items === null && !error ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : items && items.length === 0 ? (
        <EmptyState icon={ListChecks} title="No candidates below threshold" description="Scored candidates under the threshold who are awaiting a decision will be listed here with a one-line reason." />
      ) : items ? (
        <div className="rounded-lg border">
          <div className="flex items-center gap-3 border-b px-4 py-2.5 text-sm">
            <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? new Set(items.map((i) => i.c.id)) : new Set())} aria-label="Select all" />
            <span className="text-muted-foreground">{selected.size ? `${selected.size} of ${items.length} selected` : `${items.length} candidate${items.length === 1 ? '' : 's'}`}</span>
          </div>
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.c.id} className="flex items-start gap-3 px-4 py-3">
                <Checkbox className="mt-1" checked={selected.has(i.c.id)} onCheckedChange={() => toggle(i.c.id)} aria-label={`Select ${i.name}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setOpenId(i.c.id)}>
                      {i.name}
                    </button>
                    {i.c.is_demo && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-800">DEMO</Badge>}
                    <span className="text-xs text-muted-foreground">{i.role?.code} · overall {i.overall.toFixed(0)} · ATS {i.ats.toFixed(0)} · Pattern {i.pattern.toFixed(0)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground" title={i.reason}>{i.reason}</p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{daysWaiting(i.c) ?? '—'}d waiting</span>
                <Button size="sm" variant="ghost" onClick={() => setOpenId(i.c.id)}>Review</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <CandidateDrawer candidateId={openId} onClose={() => setOpenId(null)} onChanged={load} />

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Pass for {selected.size} candidate{selected.size === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              This records your decision in the decision log. No email is sent. Rejection emails will be drafted for your review in the Outbox and sent only when you click Send.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 overflow-y-auto text-sm">{selectedItems.map((i) => <li key={i.c.id}>{i.name} <span className="text-muted-foreground">({i.overall.toFixed(0)})</span></li>)}</ul>
          <div className="grid gap-2">
            <Label htmlFor="bulk-reason">Reason (optional, applied to all)</Label>
            <Input id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={confirmPass} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Confirm Pass
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
