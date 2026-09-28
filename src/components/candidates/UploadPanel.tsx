import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { intakeFile, scoreCandidate, type IntakeStage, type Role } from '@/lib/candidates'
import { ACCEPT_ATTR } from '@/lib/extract'
import { cn } from '@/lib/utils'

const MAX_FILES = 100
const CONCURRENCY = 3

type Item = { key: string; file: File; roleId: string; stage: IntakeStage; detail?: string }

const STAGE: Record<IntakeStage, { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'text-muted-foreground' },
  reading: { label: 'Reading…', cls: 'text-muted-foreground' },
  uploading: { label: 'Uploaded → parsing…', cls: 'text-muted-foreground' },
  scoring: { label: 'Parsed → scoring…', cls: 'text-muted-foreground' },
  scored: { label: 'Scored', cls: 'text-emerald-700' },
  unreadable: { label: 'Unreadable – needs manual review', cls: 'text-red-700' },
  needs_name: { label: 'Needs name', cls: 'text-amber-800' },
  error: { label: 'Error', cls: 'text-red-700' },
}

export function UploadPanel({ roles, disabledReason, onProcessed }: { roles: Role[]; disabledReason: string | null; onProcessed: () => void }) {
  const [batchRole, setBatchRole] = useState(roles[0]?.id ?? '')
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const update = (key: string, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  function add(files: FileList | File[]) {
    const incoming = Array.from(files)
    const room = MAX_FILES - items.length
    if (incoming.length > room) toast.warning(`Only ${MAX_FILES} files per batch. ${incoming.length - room} not added.`)
    setItems((xs) => [
      ...xs,
      ...incoming.slice(0, Math.max(0, room)).map((file) => ({ key: crypto.randomUUID(), file, roleId: batchRole, stage: 'queued' as const })),
    ])
  }

  async function processOne(item: Item, batchId: string) {
    const { id, scorable } = await intakeFile(item.file, item.roleId, batchId, (stage, detail) => update(item.key, { stage, detail }))
    if (!id || !scorable) return
    update(item.key, { stage: 'scoring' })
    try {
      const res = await scoreCandidate(id)
      update(item.key, { stage: res.status === 'scored' ? 'scored' : res.status === 'needs_name' ? 'needs_name' : 'unreadable' })
    } catch (err) {
      update(item.key, { stage: 'error', detail: err instanceof Error ? err.message : 'Scoring failed' })
    }
  }

  async function start() {
    const queue = items.filter((i) => i.stage === 'queued')
    if (!queue.length) return
    setRunning(true)
    const batchId = crypto.randomUUID()
    let next = 0
    const worker = async () => {
      while (next < queue.length) {
        const item = queue[next++]
        await processOne(item, batchId)
        onProcessed()
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    setRunning(false)
    toast.success(`Processed ${queue.length} CV${queue.length === 1 ? '' : 's'}`)
    onProcessed()
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (!running && !disabledReason) add(e.dataTransfer.files)
  }

  const queued = items.filter((i) => i.stage === 'queued').length
  const done = items.filter((i) => ['scored', 'unreadable', 'needs_name', 'error'].includes(i.stage)).length

  return (
    <Card className="mb-8 py-5">
      <CardContent className="grid gap-4 px-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="batch-role">Applied role for this batch</Label>
            <Select value={batchRole} onValueChange={(v) => { setBatchRole(v); setItems((xs) => xs.map((x) => (x.stage === 'queued' ? { ...x, roleId: v } : x))) }}>
              <SelectTrigger id="batch-role" className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            {items.length > 0 && !running && (
              <Button variant="ghost" onClick={() => setItems([])}>Clear list</Button>
            )}
            <Button onClick={start} disabled={running || queued === 0 || !!disabledReason}>
              {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {running ? `Processing ${done}/${items.length}…` : `Upload & score ${queued || ''}`.trim()}
            </Button>
          </div>
        </div>

        {disabledReason && (
          <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="size-4 shrink-0" aria-hidden /> {disabledReason}
          </p>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors', dragging && 'border-primary bg-accent')}
        >
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm">Drop up to {MAX_FILES} CVs here, or</p>
          <Button type="button" variant="outline" size="sm" disabled={running || !!disabledReason} onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          <p className="text-xs text-muted-foreground">
            PDF, DOCX or TXT, up to 10 MB each. Scanned images can't be read and are flagged, never guessed.
          </p>
          <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1}
            onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
        </div>

        {items.length > 0 && (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border" aria-live="polite">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={item.file.name}>{item.file.name}</span>
                {item.stage === 'queued' ? (
                  <>
                    <Select value={item.roleId} onValueChange={(v) => update(item.key, { roleId: v })}>
                      <SelectTrigger size="sm" className="w-48" aria-label={`Role for ${item.file.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" aria-label={`Remove ${item.file.name}`} onClick={() => setItems((xs) => xs.filter((x) => x.key !== item.key))}>
                      <X className="size-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge variant="outline" className="font-normal">{roles.find((r) => r.id === item.roleId)?.code}</Badge>
                    <span className={cn('flex items-center gap-1.5 text-xs', STAGE[item.stage].cls)} title={item.detail}>
                      {['reading', 'uploading', 'scoring'].includes(item.stage) && <Loader2 className="size-3 animate-spin" aria-hidden />}
                      {item.stage === 'scored' && <CheckCircle2 className="size-3" aria-hidden />}
                      {STAGE[item.stage].label}{item.detail && item.stage === 'error' ? `: ${item.detail}` : ''}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
