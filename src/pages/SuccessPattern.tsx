import { AlertTriangle, ArrowLeft, CheckCircle2, CopyPlus, Loader2, Plus, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { SignalCard, SignalForm } from '@/components/pattern/SignalCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  addSignal,
  approvePattern,
  cloneAsDraft,
  extractPattern,
  listPatterns,
  listSignals,
  type PatternStatus,
  type PatternSummary,
  type Signal,
} from '@/lib/patterns'

const STATUS_CLASS: Record<PatternStatus, string> = {
  draft: 'border-amber-200 bg-amber-50 text-amber-900',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  superseded: 'border-slate-200 bg-slate-50 text-slate-600',
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export function SuccessPatternPage() {
  const [params, setParams] = useSearchParams()
  const [patterns, setPatterns] = useState<PatternSummary[] | null>(null)
  const [signals, setSignals] = useState<Signal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [busy, setBusy] = useState<null | 'approve' | 'clone' | 'extract'>(null)

  const selectedId = params.get('v') ?? patterns?.[0]?.id ?? null
  const pattern = patterns?.find((p) => p.id === selectedId) ?? null
  const editable = pattern?.status === 'draft'

  const loadPatterns = useCallback(async () => {
    try {
      setPatterns(await listPatterns())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load patterns')
    }
  }, [])

  const loadSignals = useCallback(async () => {
    if (!selectedId) return setSignals([])
    try {
      setSignals(await listSignals(selectedId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load signals')
    }
  }, [selectedId])

  useEffect(() => { loadPatterns() }, [loadPatterns])
  useEffect(() => { if (patterns) loadSignals() }, [patterns, loadSignals])

  const select = (id: string) => setParams({ v: id })

  async function approve() {
    if (!pattern) return
    setBusy('approve')
    try {
      await approvePattern(pattern.id)
      toast.success(`Pattern v${pattern.version} approved. Candidates will be scored against it.`)
      setConfirmApprove(false)
      await loadPatterns()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve')
    } finally {
      setBusy(null)
    }
  }

  async function clone() {
    if (!pattern) return
    setBusy('clone')
    try {
      const id = await cloneAsDraft(pattern.id)
      toast.success('New draft created. Edit it, then approve.')
      await loadPatterns()
      select(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create draft')
    } finally {
      setBusy(null)
    }
  }

  async function reExtract() {
    setBusy('extract')
    try {
      const result = await extractPattern()
      toast.success(`Draft v${result.version} extracted: ${result.signals} signals from ${result.sample_size} hires.`)
      await loadPatterns()
      select(result.pattern_id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setBusy(null)
    }
  }

  const approved = patterns?.find((p) => p.status === 'approved')

  return (
    <>
      <Link to="/reference-hires" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Reference hires
      </Link>
      <PageHeader
        title="Success pattern"
        description="What your best hires have in common, as observable CV signals. Review, edit, delete or add signals, then approve. No candidate is scored until a pattern is approved."
        actions={
          <Button variant="outline" onClick={reExtract} disabled={busy !== null}>
            {busy === 'extract' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {busy === 'extract' ? 'Extracting… (up to a minute)' : 'Extract new draft'}
          </Button>
        }
      />

      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}

      {patterns === null ? (
        <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : patterns.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No pattern extracted yet"
          description="Extract a draft from your reference hires. You'll review it here before anything is scored."
        />
      ) : pattern ? (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Select value={pattern.id} onValueChange={select}>
              <SelectTrigger className="w-64" aria-label="Pattern version"><SelectValue /></SelectTrigger>
              <SelectContent>
                {patterns.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    v{p.version} · {p.status} · {formatDate(p.created_at)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className={STATUS_CLASS[pattern.status]}>
              {pattern.status === 'approved' ? 'Approved – in use for scoring' : pattern.status === 'draft' ? 'Draft – not in use' : 'Superseded'}
            </Badge>
            <div className="ml-auto flex gap-2">
              {pattern.status !== 'draft' && (
                <Button variant="outline" onClick={clone} disabled={busy !== null}>
                  <CopyPlus className="size-4" aria-hidden /> Edit as new draft
                </Button>
              )}
              {pattern.status === 'draft' && (
                <Button onClick={() => setConfirmApprove(true)} disabled={busy !== null || !signals?.length}>
                  <CheckCircle2 className="size-4" aria-hidden /> Approve pattern
                </Button>
              )}
            </div>
          </div>

          <div role="note" className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Pattern based on {pattern.sample_size} reference hires — small sample. Review before use.</p>
              {pattern.notes && <p className="mt-1">{pattern.notes}</p>}
            </div>
          </div>

          {pattern.warnings.length > 0 && (
            <details className="mb-6 rounded-lg border px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">Evidence checks ({pattern.warnings.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {pattern.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          <p className="mb-4 text-xs text-muted-foreground">
            Generated {formatDate(pattern.generated_at)} by {pattern.model ?? '—'} ({pattern.prompt_version ?? '—'})
            {pattern.approved_at && <> · Approved {formatDate(pattern.approved_at)}</>}
            {!editable && ' · Read-only: this version is the record of what scored candidates.'}
          </p>

          {signals === null ? (
            <div className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
          ) : (
            <div className="grid gap-4">
              {signals.map((s, i) => (
                <SignalCard key={s.id} signal={s} index={i} editable={editable} onChanged={loadSignals} />
              ))}
              {signals.length === 0 && (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  No signals. Add at least one before approving.
                </p>
              )}

              {editable && (adding ? (
                <Card className="py-5">
                  <CardContent className="px-5">
                    <h3 className="mb-4 font-medium">Add your own signal</h3>
                    <SignalForm
                      initial={{ name: '', description: '', observable_evidence: '', confidence: 'medium' }}
                      submitLabel="Add signal"
                      onCancel={() => setAdding(false)}
                      onSubmit={async (input) => {
                        try {
                          await addSignal(pattern.id, input, signals.length)
                          toast.success('Signal added')
                          setAdding(false)
                          loadSignals()
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Could not add')
                        }
                      }}
                    />
                  </CardContent>
                </Card>
              ) : (
                <Button variant="outline" className="justify-self-start" onClick={() => setAdding(true)}>
                  <Plus className="size-4" aria-hidden /> Add signal
                </Button>
              ))}
            </div>
          )}
        </>
      ) : null}

      <Dialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve pattern v{pattern?.version}?</DialogTitle>
            <DialogDescription>
              Candidates will be scored against these {signals?.length ?? 0} signals, and each evaluation will record
              this version.{approved && approved.id !== pattern?.id && ` v${approved.version} will be marked superseded.`} Approved
              versions are locked; to change it later, create a new draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmApprove(false)}>Cancel</Button>
            <Button onClick={approve} disabled={busy === 'approve'}>
              {busy === 'approve' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Approve pattern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
