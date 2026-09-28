import { AlertTriangle, CheckCircle2, CopyPlus, FileUp, Loader2, Plus, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { ACCEPT_ATTR, extractText } from '@/lib/extract'
import {
  addRequirement,
  cloneJd,
  createDraft,
  extractRequirements,
  KIND_LABEL,
  saveJd,
  updateYears,
  type RequirementKind,
  type Role,
} from '@/lib/jobDescriptions'
import { RequirementEditor, RequirementRow } from './RequirementRow'

const GROUPS: RequirementKind[] = ['must_have', 'nice_to_have', 'responsibility', 'not_scored']
const GROUP_HINT: Record<RequirementKind, string> = {
  must_have: 'Missing ones show as red flags, never as automatic rejections. 70% of the keyword score.',
  nice_to_have: '30% of the keyword score.',
  responsibility: 'Used to judge experience fit and to write interview probes.',
  not_scored: 'Kept for your reference only. Never used to score a candidate.',
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export function JdCard({ role, onChanged }: { role: Role; onChanged: () => void }) {
  const jd = role.job_descriptions[0] ?? null
  const editable = jd?.status === 'draft'
  const [busy, setBusy] = useState<null | 'extract' | 'save' | 'clone'>(null)
  const [adding, setAdding] = useState<RequirementKind | null>(null)
  const [confirmSave, setConfirmSave] = useState(false)

  async function run<T>(kind: 'extract' | 'save' | 'clone', fn: () => Promise<T>, ok: string) {
    setBusy(kind)
    try {
      await fn()
      toast.success(ok)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  const reqs = jd?.jd_requirements ?? []
  const musts = reqs.filter((r) => r.kind === 'must_have').length

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{role.title}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {jd ? (
              <>v{jd.version}{jd.source_file_name && ` · ${jd.source_file_name}`}
                {jd.saved_at ? ` · saved ${formatDate(jd.saved_at)}` : jd.extracted_at ? ` · extracted ${formatDate(jd.extracted_at)} by ${jd.extraction_model}` : ''}</>
            ) : 'No job description yet'}
          </p>
        </div>
        {jd && (
          <Badge
            variant="outline"
            className={jd.status === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}
          >
            {jd.status === 'saved' ? 'Saved – used for scoring' : 'Draft – review and save'}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="grid gap-6">
        {!jd ? (
          <NewJdForm roleId={role.id} onCreated={onChanged} />
        ) : (
          <>
            {jd.warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <ul className="space-y-1">{jd.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}

            <YearsEditor
              key={`${jd.id}-${jd.years_required_min}-${jd.years_required_max}`}
              jdId={jd.id}
              min={jd.years_required_min}
              max={jd.years_required_max}
              editable={editable}
              onSaved={onChanged}
            />

            {GROUPS.map((kind) => {
              const items = reqs.filter((r) => r.kind === kind)
              if (!items.length && !editable) return null
              return (
                <section key={kind} aria-labelledby={`${jd.id}-${kind}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 id={`${jd.id}-${kind}`} className="text-sm font-medium">
                      {KIND_LABEL[kind]}s <span className="font-normal text-muted-foreground">({items.length})</span>
                    </h3>
                    {editable && adding !== kind && (
                      <Button size="sm" variant="ghost" onClick={() => setAdding(kind)}>
                        <Plus className="size-4" aria-hidden /> Add
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{GROUP_HINT[kind]}</p>
                  <ul className="mt-1 divide-y">
                    {items.map((r) => <RequirementRow key={r.id} req={r} editable={editable} onChanged={onChanged} />)}
                  </ul>
                  {adding === kind && (
                    <div className="mt-2">
                      <RequirementEditor
                        initial={{ kind, text: '', synonyms: [] }}
                        onCancel={() => setAdding(null)}
                        onSave={async (input) => {
                          try {
                            await addRequirement(jd.id, input, reqs.length + 200)
                            setAdding(null)
                            onChanged()
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : 'Could not add')
                          }
                        }}
                      />
                    </div>
                  )}
                </section>
              )
            })}

            {jd.source_text && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show job description text</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-xs">{jd.source_text}</pre>
              </details>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              {editable ? (
                <>
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => run('extract', () => extractRequirements(jd.id), 'Requirements re-extracted')}
                  >
                    {busy === 'extract' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                    Re-extract
                  </Button>
                  <Button disabled={busy !== null || musts === 0 || jd.years_required_min === null} onClick={() => setConfirmSave(true)}>
                    <CheckCircle2 className="size-4" aria-hidden /> Save job description
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={busy !== null} onClick={() => run('clone', () => cloneJd(jd.id), 'New draft version created')}>
                  <CopyPlus className="size-4" aria-hidden /> Edit as new version
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmSave} onOpenChange={setConfirmSave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save {role.title} v{jd?.version}?</DialogTitle>
            <DialogDescription>
              Candidates for this role will be scored against these {musts} must-haves and{' '}
              {reqs.filter((r) => r.kind === 'nice_to_have').length} nice-to-haves, with {jd?.years_required_min}
              {jd?.years_required_max ? `–${jd.years_required_max}` : '+'} years required. Saved versions are locked;
              to change it later, create a new version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSave(false)}>Cancel</Button>
            <Button
              disabled={busy === 'save'}
              onClick={async () => {
                if (!jd) return
                await run('save', () => saveJd(jd.id), `${role.title} job description saved`)
                setConfirmSave(false)
              }}
            >
              {busy === 'save' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function YearsEditor({
  jdId, min, max, editable, onSaved,
}: { jdId: string; min: number | null; max: number | null; editable: boolean; onSaved: () => void }) {
  const [lo, setLo] = useState(min?.toString() ?? '')
  const [hi, setHi] = useState(max?.toString() ?? '')
  const dirty = lo !== (min?.toString() ?? '') || hi !== (max?.toString() ?? '')
  const parse = (s: string) => (s.trim() === '' ? null : Number(s))
  const invalid = [lo, hi].some((s) => s.trim() !== '' && (Number.isNaN(Number(s)) || Number(s) < 0)) ||
    (parse(lo) !== null && parse(hi) !== null && parse(hi)! < parse(lo)!)

  if (!editable) {
    return (
      <p className="text-sm">
        <span className="font-medium">Years of product experience: </span>
        {min ?? '—'}{max !== null ? `–${max}` : '+'}
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${jdId}-min`}>Years required (min)</Label>
        <Input id={`${jdId}-min`} className="w-28" inputMode="decimal" value={lo} onChange={(e) => setLo(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${jdId}-max`}>Max (optional)</Label>
        <Input id={`${jdId}-max`} className="w-28" inputMode="decimal" value={hi} onChange={(e) => setHi(e.target.value)} />
      </div>
      {dirty && (
        <Button
          size="sm"
          disabled={invalid}
          onClick={async () => {
            try {
              await updateYears(jdId, parse(lo), parse(hi))
              toast.success('Years updated')
              onSaved()
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not save')
            }
          }}
        >
          Update years
        </Button>
      )}
    </div>
  )
}

function NewJdForm({ roleId, onCreated }: { roleId: string; onCreated: () => void }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File) {
    try {
      const r = await extractText(file)
      if (!r.readable) return toast.error(`${file.name} has too little readable text (${r.chars} characters). Paste the text instead.`)
      setText(r.text)
      setFileName(file.name)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read file')
    }
  }

  async function submit() {
    setBusy(true)
    try {
      const id = await createDraft(roleId, text.trim(), fileName)
      await extractRequirements(id)
      toast.success('Requirements extracted. Review them, then save.')
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not extract')
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <Label htmlFor={`${roleId}-jd`}>Paste the job description, or upload a file</Label>
      <Textarea id={`${roleId}-jd`} rows={8} value={text} onChange={(e) => { setText(e.target.value); setFileName(null) }} />
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" aria-hidden /> Upload PDF, DOCX or TXT
        </Button>
        <input ref={fileRef} type="file" accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
        <Button onClick={submit} disabled={busy || text.trim().length < 200}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {busy ? 'Extracting…' : 'Extract requirements'}
        </Button>
      </div>
    </div>
  )
}
