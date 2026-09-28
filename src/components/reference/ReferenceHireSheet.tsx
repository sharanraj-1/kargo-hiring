import { AlertTriangle, ExternalLink, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
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
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ACCEPT_ATTR, MIN_READABLE_CHARS } from '@/lib/extract'
import {
  deleteReferenceDoc,
  deleteReferenceHire,
  openReferenceDoc,
  RATING_LABEL,
  saveReferenceHire,
  TENURE_LABEL,
  uploadReferenceDoc,
  type Rating,
  type ReferenceDoc,
  type ReferenceHire,
  type ReferenceHireInput,
  type Tenure,
} from '@/lib/referenceHires'
import { cn } from '@/lib/utils'
import { AiProfile } from './AiProfile'
import { ReferenceTypeBadge } from './badges'

const EMPTY: ReferenceHireInput = {
  name: '',
  role_title: '',
  joined_on: null,
  last_rating: null,
  still_at_kargo: null,
  is_product_role: false,
  application_standout: null,
  interview_revealed: null,
  outcome_note: null,
}

function toInput(hire: ReferenceHire | null): ReferenceHireInput {
  if (!hire) return EMPTY
  const { name, role_title, joined_on, last_rating, still_at_kargo, is_product_role, application_standout, interview_revealed, outcome_note } = hire
  return { name, role_title, joined_on, last_rating, still_at_kargo, is_product_role, application_standout, interview_revealed, outcome_note }
}

const toMonth = (iso: string | null) => (iso ? iso.slice(0, 7) : '')
const fromMonth = (month: string) => (month ? `${month}-01` : null)
const nullIfBlank = (v: string) => (v.trim() ? v : null)

type SheetProps = {
  /** null = creating a new hire */
  hire: ReferenceHire | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: (selectId?: string) => void
}

export function ReferenceHireSheet(props: SheetProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {/* Content unmounts on close, so form state resets each time the sheet opens. */}
        <SheetBody {...props} />
      </SheetContent>
    </Sheet>
  )
}

function SheetBody({ hire, onOpenChange, onChanged }: SheetProps) {
  const [form, setForm] = useState<ReferenceHireInput>(() => toInput(hire))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof ReferenceHireInput>(key: K, value: ReferenceHireInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const id = await saveReferenceHire(hire?.id ?? null, {
        ...form,
        name: form.name.trim(),
        role_title: form.role_title.trim(),
      })
      toast.success(hire ? 'Reference hire saved' : 'Reference hire added')
      onChanged(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!hire) return
    try {
      await deleteReferenceHire(hire)
      toast.success(`${hire.name} removed`)
      setConfirmDelete(false)
      onOpenChange(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  return (
    <>
        <SheetHeader className="border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <SheetTitle>{hire ? hire.name : 'Add reference hire'}</SheetTitle>
            {hire && <ReferenceTypeBadge type={hire.reference_type} />}
          </div>
          <SheetDescription>
            {hire ? hire.role_title : 'A past hire whose outcome can calibrate the success pattern.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="grid gap-5 px-6 py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name">
              <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field id="role" label="Role hired into">
              <Input id="role" value={form.role_title} onChange={(e) => set('role_title', e.target.value)} required />
            </Field>
            <Field id="joined" label="Join month">
              <Input
                id="joined"
                type="month"
                value={toMonth(form.joined_on)}
                onChange={(e) => set('joined_on', fromMonth(e.target.value))}
              />
            </Field>
            <Field id="rating" label="Last performance rating">
              <Select value={form.last_rating ?? ''} onValueChange={(v) => set('last_rating', v as Rating)}>
                <SelectTrigger id="rating" className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(RATING_LABEL) as Rating[]).map((r) => (
                    <SelectItem key={r} value={r}>{RATING_LABEL[r]} expectations</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="tenure" label="Still at Kargo?">
              <Select value={form.still_at_kargo ?? ''} onValueChange={(v) => set('still_at_kargo', v as Tenure)}>
                <SelectTrigger id="tenure" className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TENURE_LABEL) as Tenure[]).map((t) => (
                    <SelectItem key={t} value={t}>{TENURE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_product_role}
                  onCheckedChange={(c) => set('is_product_role', c === true)}
                />
                Product role (weighted higher for PM/SPM)
              </label>
            </div>
          </div>

          <Field id="standout" label="What stood out in their application">
            <Textarea
              id="standout"
              rows={3}
              value={form.application_standout ?? ''}
              onChange={(e) => set('application_standout', nullIfBlank(e.target.value))}
            />
          </Field>
          <Field id="interview" label="What the interview revealed">
            <Textarea
              id="interview"
              rows={3}
              value={form.interview_revealed ?? ''}
              onChange={(e) => set('interview_revealed', nullIfBlank(e.target.value))}
            />
          </Field>
          <Field id="outcome" label="One-line outcome note">
            <Input
              id="outcome"
              value={form.outcome_note ?? ''}
              onChange={(e) => set('outcome_note', nullIfBlank(e.target.value))}
            />
          </Field>

          <div className="flex items-center justify-between gap-2">
            {hire ? (
              <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden /> Remove hire
              </Button>
            ) : <span />}
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {hire ? 'Save changes' : 'Add hire'}
            </Button>
          </div>
        </form>

        {hire?.ai_profile && (
          <>
            <Separator />
            <section aria-labelledby="ai-heading" className="px-6 py-6">
              <h3 id="ai-heading" className="mb-3 text-sm font-medium">AI analysis of their CV</h3>
              <AiProfile profile={hire.ai_profile} model={hire.ai_profile_model} at={hire.ai_profiled_at} />
            </section>
          </>
        )}

        <Separator />

        <section aria-labelledby="docs-heading" className="px-6 py-6">
          <h3 id="docs-heading" className="text-sm font-medium">Documents</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            CVs or profile notes. Stored privately; only readable by you.
          </p>
          {hire ? (
            <DocumentsPanel hire={hire} onChanged={() => onChanged(hire.id)} />
          ) : (
            <p className="mt-4 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
              Add the hire first, then upload their documents.
            </p>
          )}
        </section>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {hire?.name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the hire and {hire?.reference_docs.length ?? 0} uploaded document(s).
              Existing pattern versions keep their record of this hire.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={onDelete}>Remove permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

function DocumentsPanel({ hire, onChanged }: { hire: ReferenceHire; onChanged: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function upload(files: FileList | File[]) {
    const list = Array.from(files)
    if (!list.length) return
    for (const file of list) {
      setBusy(file.name)
      const result = await uploadReferenceDoc(hire.id, file)
      if (!result.ok) toast.error(`${result.fileName}: ${result.error}`)
      else if (!result.readable)
        toast.warning(`${result.fileName}: unreadable (${result.chars} characters). Upload a text-based copy.`)
      else toast.success(`${result.fileName} uploaded`)
    }
    setBusy(null)
    if (inputRef.current) inputRef.current.value = ''
    onChanged()
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (!busy) upload(e.dataTransfer.files)
  }

  async function remove(doc: ReferenceDoc) {
    try {
      await deleteReferenceDoc(doc)
      toast.success(`${doc.file_name} removed`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove')
    }
  }

  return (
    <div className="mt-4 grid gap-3">
      {hire.reference_docs.length > 0 && (
        <ul className="divide-y rounded-md border">
          {hire.reference_docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate">{doc.file_name}</p>
                {doc.is_readable ? (
                  <p className="text-xs text-muted-foreground">{doc.text_chars?.toLocaleString()} characters extracted</p>
                ) : (
                  <p className="flex items-center gap-1 text-xs text-red-700">
                    <AlertTriangle className="size-3" aria-hidden />
                    Unreadable – needs manual review ({doc.text_chars ?? 0} characters)
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Open ${doc.file_name}`}
                onClick={() => openReferenceDoc(doc).catch((e) => toast.error(e.message))}
              >
                <ExternalLink className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${doc.file_name}`} onClick={() => remove(doc)}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors',
          dragging && 'border-primary bg-accent',
        )}
      >
        {busy ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Reading {busy}…
          </p>
        ) : (
          <>
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm">Drop files here, or</p>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
            <p className="text-xs text-muted-foreground">
              PDF, DOCX or TXT, up to 10 MB. Files with under {MIN_READABLE_CHARS} characters of text are flagged unreadable.
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>
    </div>
  )
}
