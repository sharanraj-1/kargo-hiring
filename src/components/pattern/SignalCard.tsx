import { AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ReferenceTypeBadge } from '@/components/reference/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { deleteSignal, updateSignal, type Confidence, type Signal, type SignalInput } from '@/lib/patterns'

const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  medium: 'border-amber-200 bg-amber-50 text-amber-900',
  low: 'border-slate-200 bg-slate-50 text-slate-700',
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge variant="outline" className={CONFIDENCE_CLASS[confidence]}>
      {confidence[0].toUpperCase() + confidence.slice(1)} confidence
    </Badge>
  )
}

export function SignalForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: SignalInput
  submitLabel: string
  onSubmit: (input: SignalInput) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof SignalInput>(k: K, v: SignalInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit({
        name: form.name.trim(),
        description: form.description.trim(),
        observable_evidence: form.observable_evidence.trim(),
        confidence: form.confidence,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="grid gap-2">
          <Label htmlFor="sig-name">Signal name</Label>
          <Input id="sig-name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sig-conf">Confidence</Label>
          <Select value={form.confidence} onValueChange={(v) => set('confidence', v as Confidence)}>
            <SelectTrigger id="sig-conf" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sig-desc">Description</Label>
        <Textarea id="sig-desc" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sig-look">What to look for in a CV</Label>
        <Textarea
          id="sig-look"
          rows={2}
          value={form.observable_evidence}
          onChange={(e) => set('observable_evidence', e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          Observable behaviours or experiences only. Never college, company prestige, location, age or gender.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{submitLabel}</Button>
      </div>
    </form>
  )
}

export function SignalCard({
  signal,
  index,
  editable,
  onChanged,
}: {
  signal: Signal
  index: number
  editable: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)

  async function save(input: SignalInput) {
    try {
      await updateSignal(signal, input)
      toast.success('Signal updated')
      setEditing(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  async function remove() {
    try {
      await deleteSignal(signal)
      toast.success(`Removed "${signal.name}"`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove')
    }
  }

  return (
    <Card className="py-5">
      <CardContent className="px-5">
        {editing ? (
          <SignalForm initial={signal} submitLabel="Save signal" onSubmit={save} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium">
                  <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}.</span>
                  {signal.name}
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <ConfidenceBadge confidence={signal.confidence} />
                  {signal.origin === 'founder' ? (
                    <Badge variant="outline">Added by you</Badge>
                  ) : signal.edited_by_founder ? (
                    <Badge variant="outline">AI · edited by you</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">AI draft</Badge>
                  )}
                  {signal.bias_flags.length > 0 && (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
                      <AlertTriangle className="size-3" aria-hidden /> Bias check: {signal.bias_flags.join(', ')}
                    </Badge>
                  )}
                </div>
              </div>
              {editable && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={remove}>
                    <Trash2 className="size-4" aria-hidden /> Delete
                  </Button>
                </div>
              )}
            </div>

            <p className="mt-3 text-sm">{signal.description}</p>
            <div className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="font-medium">Look for: </span>
              {signal.observable_evidence}
            </div>
            {signal.confidence_rationale && (
              <p className="mt-2 text-xs text-muted-foreground">Why this confidence: {signal.confidence_rationale}</p>
            )}

            {signal.reference_quotes.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Evidence from reference hires ({signal.reference_quotes.length})
                </h4>
                <ul className="mt-2 grid gap-2">
                  {signal.reference_quotes.map((q, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{q.hire_name}</span>
                        <ReferenceTypeBadge type={q.reference_type} className="text-[11px]" />
                      </div>
                      <blockquote className="mt-1 border-l-2 pl-3 text-muted-foreground">“{q.quote}”</blockquote>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {signal.counter_examples.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Not shown by ({signal.counter_examples.length})
                </summary>
                <ul className="mt-2 grid gap-1.5">
                  {signal.counter_examples.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.hire_name}</span>{' '}
                      <span className="text-muted-foreground">({c.reference_type}): {c.note}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
