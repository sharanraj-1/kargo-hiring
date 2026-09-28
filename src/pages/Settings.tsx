import { AlertTriangle, Loader2, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { deleteDemoCandidates, listCandidates, scoreCandidate } from '@/lib/candidates'
import {
  addRole,
  getSettings,
  listAllRoles,
  recomputeScores,
  saveSettings,
  sendTestEmail,
  updateRole,
  type RoleRow,
  type Settings,
  type TemplateSet,
} from '@/lib/settings'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-5">{children}</CardContent>
    </Card>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [roles, setRoles] = useState<RoleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([getSettings(), listAllRoles()])
      setSettings(s)
      setRoles(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings')
    }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <>
      <PageHeader title="Settings" description="Scoring, roles, sender details, email templates and maintenance. Every change is recorded in the audit log." />
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
      {!settings || !roles ? (
        <div className="grid gap-6"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      ) : (
        <div className="grid max-w-4xl gap-6">
          <ScoringSection key={`s-${JSON.stringify(settings)}`} settings={settings} onSaved={load} />
          <RolesSection roles={roles} onChanged={load} />
          <SenderSection key={`e-${JSON.stringify(settings)}`} settings={settings} onSaved={load} />
          <TemplatesSection key={`t-${JSON.stringify(settings)}`} settings={settings} roleTitle={roles[0]?.title ?? 'Product Manager'} onSaved={load} />
          <DangerZone />
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
function ScoringSection({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [ats, setAts] = useState(String(Math.round(settings.ats_weight * 100)))
  const [strong, setStrong] = useState(String(settings.strong_threshold))
  const [consider, setConsider] = useState(String(settings.consider_threshold))
  const [delta, setDelta] = useState(String(settings.recommend_role_delta))
  const [sla, setSla] = useState(String(settings.response_sla_days))
  const [saving, setSaving] = useState(false)

  const atsN = Number(ats), strongN = Number(strong), considerN = Number(consider), deltaN = Number(delta), slaN = Number(sla)
  const problems = [
    !(atsN >= 0 && atsN <= 100) && 'ATS weight must be 0–100%',
    !(considerN > 0 && strongN <= 100 && considerN < strongN) && 'Consider must be below Strong Fit, both between 0 and 100',
    !(deltaN >= 0 && deltaN <= 100) && 'Recommended-role gap must be 0–100',
    !(Number.isInteger(slaN) && slaN >= 1 && slaN <= 60) && 'Response SLA must be a whole number of days (1–60)',
  ].filter(Boolean) as string[]
  const scoringDirty = atsN / 100 !== settings.ats_weight || strongN !== settings.strong_threshold || considerN !== settings.consider_threshold || deltaN !== settings.recommend_role_delta
  const dirty = scoringDirty || slaN !== settings.response_sla_days

  async function save() {
    setSaving(true)
    try {
      await saveSettings({
        ats_weight: atsN / 100,
        pattern_weight: Math.round((1 - atsN / 100) * 1000) / 1000,
        strong_threshold: strongN,
        consider_threshold: considerN,
        recommend_role_delta: deltaN,
        response_sla_days: slaN,
      }, 'scoring')
      if (scoringDirty) {
        const n = await recomputeScores()
        toast.success(`Saved. ${n} evaluation${n === 1 ? '' : 's'} re-ranked with the new weights (no AI calls).`)
      } else toast.success('Saved')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Scoring" description="Overall = ATS × weight + Pattern × (100% − weight). Saving re-ranks every candidate immediately from their stored scores.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="ats-w" label="ATS weight (%)" hint={`Pattern weight: ${Number.isFinite(atsN) ? 100 - atsN : '—'}%`}>
          <Input id="ats-w" inputMode="numeric" value={ats} onChange={(e) => setAts(e.target.value)} />
        </Field>
        <Field id="strong" label="Strong Fit at or above">
          <Input id="strong" inputMode="decimal" value={strong} onChange={(e) => setStrong(e.target.value)} />
        </Field>
        <Field id="consider" label="Consider at or above" hint={`Below ${consider || '—'} = Below Threshold`}>
          <Input id="consider" inputMode="decimal" value={consider} onChange={(e) => setConsider(e.target.value)} />
        </Field>
        <Field id="delta" label="Recommend other role if it scores this much higher">
          <Input id="delta" inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </Field>
        <Field id="sla" label="Response SLA (days)" hint="Candidates waiting longer are flagged on the Overview.">
          <Input id="sla" inputMode="numeric" value={sla} onChange={(e) => setSla(e.target.value)} />
        </Field>
      </div>
      {problems.length > 0 && <ul className="text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || problems.length > 0 || saving}>
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />} Save scoring
        </Button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
function RolesSection({ roles, onChanged }: { roles: RoleRow[]; onChanged: () => void }) {
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const codeOk = /^[A-Z0-9_]{2,16}$/.test(code) && !roles.some((r) => r.code === code)

  async function patch(r: RoleRow, p: Partial<RoleRow>) {
    try {
      await updateRole(r.id, p)
      toast.success(`${r.title} updated`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update role')
    }
  }

  return (
    <Section title="Roles" description="Add roles without code changes: a new role gets its own job description card, and every candidate is scored against all active roles with a saved JD.">
      <ul className="divide-y rounded-md border">
        {roles.map((r) => (
          <li key={r.id} className="flex flex-wrap items-end gap-4 px-4 py-3">
            <div className="min-w-40 flex-1">
              <p className="font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground">{r.code}</p>
            </div>
            <Field id={`open-${r.id}`} label="Opened on">
              <Input id={`open-${r.id}`} type="date" className="w-44" defaultValue={r.opened_on ?? ''}
                onBlur={(e) => { if ((e.target.value || null) !== r.opened_on) patch(r, { opened_on: e.target.value || null }) }} />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox checked={r.is_active} onCheckedChange={(v) => patch(r, { is_active: v === true })} /> Active
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="new-code" label="New role code" hint="2–16 capitals, digits or _">
          <Input id="new-code" className="w-36" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. APM" />
        </Field>
        <Field id="new-title" label="Title">
          <Input id="new-title" className="w-64" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Associate Product Manager" />
        </Field>
        <Button variant="outline" className="mb-5" disabled={!codeOk || title.trim().length < 3} onClick={async () => {
          try {
            await addRole(code, title.trim(), roles.length + 1)
            toast.success(`${title.trim()} added. Add its job description next.`)
            setCode(''); setTitle('')
            onChanged()
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not add role')
          }
        }}>
          <Plus className="size-4" aria-hidden /> Add role
        </Button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
function SenderSection({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [f, setF] = useState({
    founder_name: settings.founder_name ?? '',
    founder_title: settings.founder_title ?? '',
    sender_name: settings.sender_name ?? '',
    sender_email: settings.sender_email ?? '',
    signature: settings.signature ?? '',
    scheduling_link: settings.scheduling_link ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== (settings[k] ?? ''))
  const emailOk = !f.sender_email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.sender_email.trim())
  const linkOk = !f.scheduling_link || /^https:\/\/\S+$/.test(f.scheduling_link.trim())

  async function save() {
    setSaving(true)
    try {
      const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
      await saveSettings(clean, 'sender')
      toast.success('Sender details saved')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Sender and signature" description="Used on every email. The sender address must be on a domain verified in your Resend account.">
      {!settings.sender_email && (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          No sender address yet: emails use Resend's shared test sender, which only delivers to your own Resend account inbox.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fname" label="Founder name"><Input id="fname" value={f.founder_name} onChange={(e) => set('founder_name', e.target.value)} /></Field>
        <Field id="ftitle" label="Founder title"><Input id="ftitle" value={f.founder_title} onChange={(e) => set('founder_title', e.target.value)} /></Field>
        <Field id="sname" label="Sender name" hint="Shown as the From name."><Input id="sname" value={f.sender_name} onChange={(e) => set('sender_name', e.target.value)} /></Field>
        <Field id="semail" label="Sender email (verified in Resend)">
          <Input id="semail" type="email" value={f.sender_email} onChange={(e) => set('sender_email', e.target.value)} placeholder="e.g. you@yourdomain.com" aria-invalid={!emailOk} />
        </Field>
        <Field id="slink" label="Interview scheduling link" hint="Calendly, Cal.com, etc. Leave empty and invites ask candidates to reply with times.">
          <Input id="slink" type="url" value={f.scheduling_link} onChange={(e) => set('scheduling_link', e.target.value)} placeholder="https://" aria-invalid={!linkOk} />
        </Field>
        <Field id="sig" label="Signature"><Textarea id="sig" rows={3} value={f.signature} onChange={(e) => set('signature', e.target.value)} /></Field>
      </div>
      {!emailOk && <p className="text-sm text-destructive">Enter a valid sender email.</p>}
      {!linkOk && <p className="text-sm text-destructive">The scheduling link must start with https://</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" disabled={testing || dirty} title={dirty ? 'Save first' : undefined} onClick={async () => {
          setTesting(true)
          try {
            const r = await sendTestEmail()
            toast.success(`Test email sent to ${r.to} from ${r.from}. Check your inbox.`)
          } catch (err) {
            toast.error(`Test email failed: ${err instanceof Error ? err.message : 'unknown error'}`)
          } finally {
            setTesting(false)
          }
        }}>
          {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />} Send test email to me
        </Button>
        <Button onClick={save} disabled={!dirty || !emailOk || !linkOk || saving}>{saving && <Loader2 className="size-4 animate-spin" aria-hidden />} Save sender details</Button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
const VARS = ['{{first_name}}', '{{role}}', '{{scheduling_link}}', '{{founder_name}}']
const KINDS = [['invite', 'Interview invite'], ['rejection', 'Rejection'], ['acknowledgement', 'Application acknowledgement']] as const

function TemplatesSection({ settings, roleTitle, onSaved }: { settings: Settings; roleTitle: string; onSaved: () => void }) {
  const [t, setT] = useState<TemplateSet>(settings.templates)
  const [mode, setMode] = useState(settings.email_drafting)
  const [keep, setKeep] = useState(settings.keep_cv_on_file)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(t) !== JSON.stringify(settings.templates) || mode !== settings.email_drafting || keep !== settings.keep_cv_on_file
  const sample = useMemo(() => ({
    first_name: 'Asha', role: roleTitle,
    scheduling_link: settings.scheduling_link ?? '(no link set: the draft asks them to reply with times)',
    founder_name: settings.founder_name ?? '',
  }), [roleTitle, settings])
  const fill = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: keyof typeof sample) => sample[k] ?? m)
  const unknownVar = Object.values(t).some((x) => /\{\{\s*(?!first_name|role|scheduling_link|founder_name)\w+\s*\}\}/.test(x.subject + x.body))

  async function save() {
    setSaving(true)
    try {
      await saveSettings({ templates: t, email_drafting: mode, keep_cv_on_file: keep }, 'templates')
      toast.success('Email settings saved')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Email templates" description={`Variables: ${VARS.join(' ')}. The signature is added automatically. Drafts are always editable and never sent without your click.`}>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">How drafts are written</legend>
        {([['ai', 'AI drafts, personalised from the CV evidence and checked against the content rules (your template if a draft breaks a rule)'], ['template', 'Always use my templates below']] as const).map(([v, l]) => (
          <label key={v} className="flex items-start gap-2 text-sm">
            <input type="radio" name="drafting" className="mt-1 accent-[var(--primary)]" checked={mode === v} onChange={() => setMode(v)} /> {l}
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox className="mt-0.5" checked={keep} onCheckedChange={(v) => setKeep(v === true)} />
        Allow rejection emails to say we'll keep their details on file for future roles (only if you genuinely will)
      </label>
      <Tabs defaultValue="invite">
        <TabsList>{KINDS.map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}</TabsList>
        {KINDS.map(([k]) => (
          <TabsContent key={k} value={k} className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="grid gap-3">
              <Field id={`${k}-subj`} label="Subject"><Input id={`${k}-subj`} value={t[k].subject} onChange={(e) => setT({ ...t, [k]: { ...t[k], subject: e.target.value } })} /></Field>
              <Field id={`${k}-body`} label="Body"><Textarea id={`${k}-body`} rows={10} value={t[k].body} onChange={(e) => setT({ ...t, [k]: { ...t[k], body: e.target.value } })} /></Field>
            </div>
            <div className="rounded-md border bg-muted/30 p-4 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
              <p className="font-medium">{fill(t[k].subject)}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{fill(t[k].body)}{settings.signature ? `\n\n${settings.signature}` : ''}</pre>
            </div>
          </TabsContent>
        ))}
      </Tabs>
      {unknownVar && <p className="text-sm text-destructive">Only {VARS.join(', ')} can be used.</p>}
      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || unknownVar || saving}>{saving && <Loader2 className="size-4 animate-spin" aria-hidden />} Save email settings</Button>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
function DangerZone() {
  const [confirm, setConfirm] = useState<null | 'demo' | 'rescore'>(null)
  const [counts, setCounts] = useState<{ demo: number; scorable: string[] }>({ demo: 0, scorable: [] })
  const [progress, setProgress] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const c = await listCandidates()
    setCounts({ demo: c.filter((x) => x.is_demo).length, scorable: c.filter((x) => x.status !== 'unreadable').map((x) => x.id) })
  }, [])
  useEffect(() => { refresh() }, [refresh])

  async function rescoreAll() {
    setConfirm(null)
    const ids = counts.scorable
    let next = 0, done = 0, failed = 0
    setProgress(`0/${ids.length}`)
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]
        try { await scoreCandidate(id) } catch { failed++ }
        setProgress(`${++done}/${ids.length}`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker))
    setProgress(null)
    toast[failed ? 'warning' : 'success'](`Re-scored ${ids.length - failed} of ${ids.length} candidates${failed ? `; ${failed} failed (retry from Candidates)` : ''}.`)
    refresh()
  }

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="text-base text-red-800">Danger zone</CardTitle>
        <CardDescription>Actions here can't be undone.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Delete demo data</p>
            <p className="text-xs text-muted-foreground">Removes all {counts.demo} candidates marked DEMO, with their files, scores and drafts.</p>
          </div>
          <Button variant="outline" className="text-destructive" disabled={!counts.demo} onClick={() => setConfirm('demo')}><Trash2 className="size-4" aria-hidden /> Delete demo data</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Re-score all candidates</p>
            <p className="text-xs text-muted-foreground">
              Runs the full AI evaluation again for {counts.scorable.length} candidates against the current approved pattern and saved JDs.
              Decisions are kept; each decision still records the evaluation it was made on.
            </p>
          </div>
          <Button variant="outline" disabled={!counts.scorable.length || !!progress} onClick={() => setConfirm('rescore')}>
            {progress ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {progress ? `Re-scoring ${progress}…` : 'Re-score all'}
          </Button>
        </div>
      </CardContent>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'demo' ? `Delete ${counts.demo} demo candidates?` : `Re-score ${counts.scorable.length} candidates?`}</DialogTitle>
            <DialogDescription>
              {confirm === 'demo'
                ? 'Real candidates are not affected.'
                : `This makes about ${counts.scorable.length * 3} Gemini calls and takes roughly ${Math.ceil((counts.scorable.length * 30) / 3 / 60)} minutes. Keep this tab open.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === 'demo' ? 'destructive' : 'default'} onClick={async () => {
              if (confirm === 'rescore') return rescoreAll()
              try {
                const n = await deleteDemoCandidates()
                toast.success(`Deleted ${n} demo candidates`)
                setConfirm(null)
                refresh()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not delete')
              }
            }}>
              {confirm === 'demo' ? 'Delete demo data' : 'Re-score all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
