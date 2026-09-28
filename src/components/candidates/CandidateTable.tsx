import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUpDown, Loader2, RotateCw, Search, ShieldAlert, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  daysWaiting,
  scoreCandidate,
  setCandidateName,
  setPriority,
  TIER_LABEL,
  type CandidateRow,
  type Role,
  type Tier,
} from '@/lib/candidates'
import { cn } from '@/lib/utils'

const TIER_CLASS: Record<Tier, string> = {
  strong_fit: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  consider: 'border-amber-200 bg-amber-50 text-amber-900',
  below_threshold: 'border-slate-200 bg-slate-100 text-slate-700',
}
const TIER_ORDER: Record<Tier, number> = { strong_fit: 0, consider: 1, below_threshold: 2 }

const DECISION_LABEL = { awaiting: 'Awaiting decision', move_forward: 'Moved forward', hold: 'On hold', pass: 'Passed' } as const
const PIPELINE_LABEL = { uploaded: 'Uploaded', parsed: 'Parsed', scored: 'Scored', unreadable: 'Unreadable', error: 'Error' } as const

type SortKey = 'rank' | 'name' | 'applied' | 'recommended' | 'overall' | 'ats' | 'pattern' | 'tier' | 'flags' | 'waiting' | 'status'

type Row = {
  c: CandidateRow
  name: string
  applied: Role | undefined
  recommended: Role | undefined
  overall: number | null
  ats: number | null
  pattern: number | null
  tier: Tier | null
  flags: string[]
  bias: string[]
  waiting: number | null
  statusLabel: string
  rank: number | null
}

export function CandidateTable({
  candidates, roles, slaDays, onChanged, onOpen,
}: {
  candidates: CandidateRow[]
  roles: Role[]
  slaDays: number
  onChanged: () => void
  onOpen: (id: string, rankLabel?: string) => void
}) {
  const [q, setQ] = useState('')
  const [role, setRole] = useState('all')
  const [tier, setTier] = useState('all')
  const [status, setStatus] = useState('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' })
  const [nameFor, setNameFor] = useState<CandidateRow | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const byRole = new Map(roles.map((r) => [r.id, r]))
    const base = candidates.map((c) => {
      const ev = c.evaluations.find((e) => e.role_id === c.applied_role_id)
      const flags = (ev?.red_flags ?? []).map((f) => f.text)
      return {
        c,
        name: c.display_label ?? c.candidate_files[0]?.file_name ?? 'Unnamed',
        applied: byRole.get(c.applied_role_id),
        recommended: c.recommended_role_id ? byRole.get(c.recommended_role_id) : undefined,
        overall: ev?.overall_score ?? null,
        ats: ev?.ats_score ?? null,
        pattern: ev?.pattern_score ?? null,
        tier: ev?.tier ?? null,
        flags,
        bias: ev?.bias_flags ?? [],
        waiting: daysWaiting(c),
        statusLabel: c.status === 'scored' ? DECISION_LABEL[c.decision_status] : PIPELINE_LABEL[c.status],
        rank: null as number | null,
      }
    })
    // Rank = position among scored candidates by overall score for their applied role.
    base.filter((r) => r.overall !== null).sort((a, b) => b.overall! - a.overall!).forEach((r, i) => { r.rank = i + 1 })
    return base
  }, [candidates, roles])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = rows.filter((r) =>
      (!needle || r.name.toLowerCase().includes(needle) || r.c.candidate_files.some((f) => f.file_name.toLowerCase().includes(needle))) &&
      (role === 'all' || r.c.applied_role_id === role) &&
      (tier === 'all' || r.tier === tier) &&
      (status === 'all' || (status.startsWith('d:') ? r.c.status === 'scored' && r.c.decision_status === status.slice(2) : r.c.status === status)) &&
      (!flaggedOnly || r.flags.length > 0 || r.bias.length > 0 || !!r.c.needs_attention),
    )
    const val = (r: Row): number | string | null => {
      switch (sort.key) {
        case 'rank': return r.rank
        case 'name': return r.name.toLowerCase()
        case 'applied': return r.applied?.code ?? ''
        case 'recommended': return r.recommended?.code ?? ''
        case 'overall': return r.overall
        case 'ats': return r.ats
        case 'pattern': return r.pattern
        case 'tier': return r.tier ? TIER_ORDER[r.tier] : null
        case 'flags': return r.flags.length
        case 'waiting': return r.waiting
        case 'status': return r.statusLabel
      }
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => {
      if (a.c.is_priority !== b.c.is_priority) return a.c.is_priority ? -1 : 1 // pinned always first
      const va = val(a), vb = val(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1 // nulls last regardless of direction
      if (vb === null) return -1
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }, [rows, q, role, tier, status, flaggedOnly, sort])

  function toggleSort(key: SortKey) {
    const numericDesc: SortKey[] = ['overall', 'ats', 'pattern', 'flags', 'waiting']
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: numericDesc.includes(key) ? 'desc' : 'asc' }))
  }

  async function togglePin(c: CandidateRow) {
    try {
      await setPriority(c.id, !c.is_priority)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update')
    }
  }

  async function retry(c: CandidateRow) {
    setRetrying(c.id)
    try {
      const r = await scoreCandidate(c.id)
      if (r.status === 'scored') toast.success('Scored')
      else if (r.status === 'needs_name') setNameFor(c)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scoring failed')
    } finally {
      setRetrying(null)
      onChanged()
    }
  }

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        {children}
        {sort.key === k ? (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />) : <ChevronsUpDown className="size-3 opacity-40" aria-hidden />}
      </button>
    </TableHead>
  )

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search candidates" placeholder="Search by name or file" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <FilterSelect label="Role" value={role} onChange={setRole} options={[['all', 'All roles'], ...roles.map((r) => [r.id, r.code] as [string, string])]} />
        <FilterSelect label="Tier" value={tier} onChange={setTier} options={[['all', 'All tiers'], ...Object.entries(TIER_LABEL)]} />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[['all', 'All statuses'], ['d:awaiting', 'Awaiting decision'], ['d:move_forward', 'Moved forward'], ['d:hold', 'On hold'], ['d:pass', 'Passed'], ['unreadable', 'Unreadable'], ['error', 'Error / needs attention'], ['uploaded', 'Processing']]}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={flaggedOnly} onCheckedChange={(v) => setFlaggedOnly(v === true)} /> Flagged only
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><span className="sr-only">Priority</span></TableHead>
              <Th k="rank">Rank</Th>
              <Th k="name">Candidate</Th>
              <Th k="applied">Applied</Th>
              <Th k="recommended">Recommended</Th>
              <Th k="overall" className="text-right">Overall</Th>
              <Th k="ats" className="text-right">ATS</Th>
              <Th k="pattern" className="text-right">Pattern</Th>
              <Th k="tier">Tier</Th>
              <Th k="flags">Red flags</Th>
              <Th k="waiting" className="text-right">Days waiting</Th>
              <Th k="status">Status</Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow
                key={r.c.id}
                tabIndex={0}
                aria-label={`Open ${r.name}`}
                onClick={() => onOpen(r.c.id, r.rank ? `rank #${r.rank} of ${rows.filter((x) => x.rank).length}` : undefined)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(r.c.id, r.rank ? `rank #${r.rank} of ${rows.filter((x) => x.rank).length}` : undefined) } }}
                className={cn('cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', r.c.is_priority && 'bg-amber-50/40')}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button size="icon" variant="ghost" className="size-7" aria-pressed={r.c.is_priority}
                    aria-label={r.c.is_priority ? `Unpin ${r.name}` : `Pin ${r.name} as priority`} onClick={() => togglePin(r.c)}>
                    <Star className={cn('size-4', r.c.is_priority ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
                  </Button>
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{r.rank ?? '—'}</TableCell>
                <TableCell className="max-w-56">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium" title={r.name}>{r.name}</span>
                    {r.c.is_demo && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-800">DEMO</Badge>}
                  </div>
                </TableCell>
                <TableCell>{r.applied?.code ?? '—'}</TableCell>
                <TableCell>
                  {r.recommended && r.recommended.id !== r.c.applied_role_id
                    ? <Badge variant="outline" className="border-primary/30 bg-accent text-accent-foreground">{r.recommended.code}</Badge>
                    : <span className="text-muted-foreground">{r.recommended ? 'Same' : '—'}</span>}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{r.overall?.toFixed(0) ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.ats?.toFixed(0) ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.pattern?.toFixed(0) ?? '—'}</TableCell>
                <TableCell>{r.tier ? <Badge variant="outline" className={TIER_CLASS[r.tier]}>{TIER_LABEL[r.tier]}</Badge> : '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {r.flags.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="cursor-default border-red-200 bg-red-50 text-red-800" tabIndex={0}>
                            <AlertTriangle className="size-3" aria-hidden /> {r.flags.length}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm"><ul className="space-y-1">{r.flags.map((f, i) => <li key={i}>{f}</li>)}</ul></TooltipContent>
                      </Tooltip>
                    )}
                    {r.bias.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} aria-label="Bias check flagged"><ShieldAlert className="size-4 text-red-700" /></span>
                        </TooltipTrigger>
                        <TooltipContent>Bias check: reasoning mentions {r.bias.join(', ')}. Review before deciding.</TooltipContent>
                      </Tooltip>
                    )}
                    {!r.flags.length && !r.bias.length && <span className="text-muted-foreground">{r.c.status === 'scored' ? 'None' : '—'}</span>}
                  </div>
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', r.waiting !== null && r.waiting > slaDays && 'font-medium text-red-700')}>
                  {r.waiting ?? '—'}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <StatusCell row={r} retrying={retrying === r.c.id} onRetry={() => retry(r.c)} onEnterName={() => setNameFor(r.c)} />
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">No candidates match these filters.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Scores are for the applied role. Days waiting counts from the application date until the first email is sent; red after {slaDays} days.
      </p>

      <NameDialog candidate={nameFor} onClose={() => setNameFor(null)} onSaved={(c) => { setNameFor(null); retry(c) }} />
    </>
  )
}

function StatusCell({ row, retrying, onRetry, onEnterName }: { row: Row; retrying: boolean; onRetry: () => void; onEnterName: () => void }) {
  const c = row.c
  if (retrying) return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden /> Scoring…</span>
  if (c.status === 'unreadable') {
    return <span className="text-xs text-red-700">Unreadable – needs manual review</span>
  }
  if (c.needs_attention === 'name_not_found') {
    return <Button size="sm" variant="outline" onClick={onEnterName}>Enter name</Button>
  }
  if (c.status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" onClick={onRetry}><RotateCw className="size-3.5" aria-hidden /> Retry</Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{c.error_message ?? 'Processing failed'}</TooltipContent>
      </Tooltip>
    )
  }
  if (c.status !== 'scored') return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden /> {row.statusLabel}</span>
  return <span className="text-sm">{row.statusLabel}</span>
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-44"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  )
}

function NameDialog({ candidate, onClose, onSaved }: { candidate: CandidateRow | null; onClose: () => void; onSaved: (c: CandidateRow) => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={!!candidate} onOpenChange={(o) => { if (!o) { onClose(); setName('') } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter the candidate's name</DialogTitle>
          <DialogDescription>
            The name in {candidate?.candidate_files[0]?.file_name ?? 'this CV'} couldn't be identified, so it wasn't sent for scoring.
            The name is used to remove it from the text before any AI step, and is stored for you only.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="cand-name">Full name as written in the CV</Label>
          <Input id="cand-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || name.trim().split(/\s+/).length < 1 || !name.trim()}
            onClick={async () => {
              if (!candidate) return
              setSaving(true)
              try {
                await setCandidateName(candidate.id, name)
                setName('')
                onSaved(candidate)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not save')
              } finally {
                setSaving(false)
              }
            }}
          >
            Save and score
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
