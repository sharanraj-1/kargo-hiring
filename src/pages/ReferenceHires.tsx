import { AlertTriangle, FileText, Loader2, Plus, ScanSearch, Sparkles, UserRoundCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { RatingBadge, ReferenceTypeBadge, TenureBadge } from '@/components/reference/badges'
import { ReferenceHireSheet } from '@/components/reference/ReferenceHireSheet'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { extractPattern, profileReferenceHire } from '@/lib/patterns'
import { listReferenceHires, type ReferenceHire } from '@/lib/referenceHires'

function formatMonth(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function ReferenceHiresPage() {
  const [rows, setRows] = useState<ReferenceHire[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async (selectId?: string) => {
    try {
      setRows(await listReferenceHires())
      setError(null)
      if (selectId) setSelectedId(selectId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reference hires')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const selected = rows?.find((r) => r.id === selectedId) ?? null
  const openHire = (id: string | null) => { setSelectedId(id); setSheetOpen(true) }

  const counts = useMemo(() => {
    const c = { positive: 0, neutral: 0, negative: 0, unclassified: 0, withDocs: 0 }
    for (const r of rows ?? []) {
      c[r.reference_type]++
      if (r.reference_docs.some((d) => d.is_readable)) c.withDocs++
    }
    return c
  }, [rows])

  // Usable = classified and has at least one readable document.
  const usable = (rows ?? []).filter((r) => r.reference_type !== 'unclassified' && r.reference_docs.some((d) => d.is_readable))
  const hasPositive = usable.some((r) => r.reference_type === 'positive')
  const hasContrast = usable.some((r) => r.reference_type !== 'positive')
  const readyToExtract = hasPositive && hasContrast

  const [busy, setBusy] = useState<null | 'profile' | 'extract'>(null)
  const [progress, setProgress] = useState('')
  const navigate = useNavigate()

  async function analyseAll() {
    setBusy('profile')
    let failed = 0
    for (const [i, hire] of usable.entries()) {
      setProgress(`${i + 1}/${usable.length}`)
      try {
        await profileReferenceHire(hire.id)
      } catch (err) {
        failed++
        toast.error(`${hire.name}: ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    setBusy(null)
    await load()
    if (!failed) toast.success(`Analysed ${usable.length} hires`)
  }

  async function extract() {
    setBusy('extract')
    try {
      const r = await extractPattern()
      toast.success(`Draft v${r.version}: ${r.signals} signals from ${r.sample_size} hires. Review and approve it.`)
      navigate(`/reference-hires/pattern?v=${r.pattern_id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Reference hires"
        description="Past hires used to calibrate the success pattern. Positive = Exceeds and still at Kargo. Neutral = Meets. Negative = Below, or left / let go."
        actions={
          <>
            <Button variant="outline" onClick={() => openHire(null)}>
              <Plus className="size-4" aria-hidden /> Add hire
            </Button>
            <Button variant="outline" onClick={analyseAll} disabled={busy !== null || usable.length === 0}>
              {busy === 'profile' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanSearch className="size-4" aria-hidden />}
              {busy === 'profile' ? `Analysing ${progress}…` : 'Analyse hires'}
            </Button>
            <Button variant="outline" asChild>
              <Link to="/reference-hires/pattern">Review pattern</Link>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span keeps the tooltip working while the button is disabled */}
                <span tabIndex={0}>
                  <Button onClick={extract} disabled={!readyToExtract || busy !== null}>
                    {busy === 'extract' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                    {busy === 'extract' ? 'Extracting…' : 'Extract success pattern'}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {readyToExtract
                  ? 'Creates a new draft pattern for you to review and approve. Takes up to a minute.'
                  : 'Needs at least one positive and one neutral or negative hire, each with a readable document.'}
              </TooltipContent>
            </Tooltip>
          </>
        }
      />

      {error && <p role="alert" className="mb-4 text-sm text-destructive">Could not load reference hires: {error}</p>}

      {rows && rows.length > 0 && (
        <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ['Positive', counts.positive],
            ['Neutral', counts.neutral],
            ['Negative', counts.negative],
            ['Needs details', counts.unclassified],
            ['With readable documents', counts.withDocs],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border px-4 py-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {counts.unclassified > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {counts.unclassified} hire{counts.unclassified === 1 ? '' : 's'} can't be used for calibration yet.
            Set <strong>Still at Kargo</strong> to classify them as positive, neutral or negative.
          </p>
        </div>
      )}

      {rows === null && !error ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : rows && rows.length === 0 ? (
        <EmptyState
          icon={UserRoundCheck}
          title="No reference hires"
          description="Add past hires to calibrate the success pattern."
          action={<Button onClick={() => openHire(null)}><Plus className="size-4" aria-hidden /> Add hire</Button>}
        />
      ) : rows ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Last rating</TableHead>
                <TableHead>Still at Kargo</TableHead>
                <TableHead>Reference type</TableHead>
                <TableHead>Documents</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const readable = r.reference_docs.filter((d) => d.is_readable).length
                const unreadable = r.reference_docs.length - readable
                return (
                  <TableRow
                    key={r.id}
                    tabIndex={0}
                    className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    onClick={() => openHire(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHire(r.id) } }}
                    aria-label={`Edit ${r.name}`}
                  >
                    <TableCell className="font-medium">
                      {r.name}
                      {r.is_product_role && <span className="ml-2 text-xs font-normal text-muted-foreground">Product</span>}
                    </TableCell>
                    <TableCell>{r.role_title}</TableCell>
                    <TableCell className="tabular-nums">{formatMonth(r.joined_on)}</TableCell>
                    <TableCell><RatingBadge rating={r.last_rating} /></TableCell>
                    <TableCell><TenureBadge tenure={r.still_at_kargo} /></TableCell>
                    <TableCell><ReferenceTypeBadge type={r.reference_type} /></TableCell>
                    <TableCell>
                      {r.reference_docs.length === 0 ? (
                        <span className="text-sm text-muted-foreground">Upload</span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-sm">
                          <FileText className="size-3.5 text-muted-foreground" aria-hidden />
                          {readable}
                          {unreadable > 0 && <span className="text-red-700">· {unreadable} unreadable</span>}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <ReferenceHireSheet
        hire={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={load}
      />
    </>
  )
}
