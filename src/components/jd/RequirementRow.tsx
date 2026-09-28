import { AlertTriangle, Check, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  deleteRequirement,
  KIND_LABEL,
  updateRequirement,
  type Requirement,
  type RequirementInput,
  type RequirementKind,
} from '@/lib/jobDescriptions'

export const parseKeywords = (s: string) =>
  [...new Set(s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean))]

export function RequirementEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: RequirementInput
  onSave: (input: RequirementInput) => Promise<void>
  onCancel: () => void
}) {
  const [text, setText] = useState(initial.text)
  const [kind, setKind] = useState<RequirementKind>(initial.kind)
  const [keywords, setKeywords] = useState(initial.synonyms.join(', '))
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!text.trim()) return
    setSaving(true)
    try {
      await onSave({ kind, text: text.trim(), synonyms: kind === 'not_scored' || kind === 'responsibility' ? [] : parseKeywords(keywords) })
    } finally {
      setSaving(false)
    }
  }

  const showKeywords = kind === 'must_have' || kind === 'nice_to_have'
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
        <Input aria-label="Requirement" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <Select value={kind} onValueChange={(v) => setKind(v as RequirementKind)}>
          <SelectTrigger aria-label="Type" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as RequirementKind[]).map((k) => (
              <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showKeywords && (
        <Input
          aria-label="Keywords, comma separated"
          placeholder="Keywords a CV would contain, comma separated"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="size-4" aria-hidden /> Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving || !text.trim()}><Check className="size-4" aria-hidden /> Save</Button>
      </div>
    </div>
  )
}

export function RequirementRow({ req, editable, onChanged }: { req: Requirement; editable: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <li>
        <RequirementEditor
          initial={req}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            try {
              await updateRequirement(req, input)
              setEditing(false)
              onChanged()
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not save')
            }
          }}
        />
      </li>
    )
  }

  return (
    <li className="group flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1 text-sm">
        <p>
          {req.text}
          {req.origin === 'founder' && <span className="ml-2 text-xs text-muted-foreground">added by you</span>}
        </p>
        {req.synonyms.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {req.synonyms.map((k) => (
              <Badge key={k} variant="secondary" className="font-normal">{k}</Badge>
            ))}
          </div>
        )}
        {req.source_quote && (
          <p className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
            {req.quote_verified === false && <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-700" aria-label="Quote not verified" />}
            <span>JD: “{req.source_quote}”</span>
          </p>
        )}
        {req.note && <p className="mt-1 text-xs text-amber-800">{req.note}</p>}
      </div>
      {editable && (
        <div className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100 focus-within:opacity-100">
          <Button size="icon" variant="ghost" aria-label={`Edit "${req.text}"`} onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete "${req.text}"`}
            onClick={async () => {
              try {
                await deleteRequirement(req)
                onChanged()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not delete')
              }
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </li>
  )
}
