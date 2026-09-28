import { AlertTriangle, CheckCircle2, Loader2, Mail, RotateCw, Send, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  candidatesMissingDrafts,
  discardDraft,
  listEmails,
  sendEmails,
  syncDrafts,
  TYPE_LABEL,
  updateDraft,
  type Email,
} from '@/lib/emails'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type Tab = 'drafts' | 'sent' | 'failed'
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export function OutboxPage() {
  const [emails, setEmails] = useState<Email[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('drafts')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null)
  const [sending, setSending] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [drafting, setDrafting] = useState(false)
  const [testSender, setTestSender] = useState(false)

  const load = useCallback(async () => {
    try {
      const [e, m, s] = await Promise.all([
        listEmails(),
        candidatesMissingDrafts(),
        supabase.from('settings').select('sender_email').eq('id', 1).single(),
      ])
      setEmails(e)
      setMissing(m)
      setTestSender(!s.data?.sender_email)
      setSelected((sel) => new Set([...sel].filter((id) => e.some((x) => x.id === id && x.status === 'draft'))))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the outbox')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => ({
    drafts: (emails ?? []).filter((e) => e.status === 'draft' || e.status === 'sending'),
    sent: (emails ?? []).filter((e) => e.status === 'sent'),
    failed: (emails ?? []).filter((e) => e.status === 'failed'),
  }), [emails])
  const list = groups[tab]
  const sendable = (e: Email) => !e.candidates?.is_demo && !!e.to_email && e.status !== 'sending'
  const selectableDrafts = groups.drafts.filter(sendable)

  async function send(ids: string[]) {
    setSending(true)
    try {
      const r = await sendEmails(ids)
      const skippedReasons = [...new Set(r.results.filter((x) => x.status === 'skipped').map((x) => x.error))]
      if (r.sent) toast.success(`Sent ${r.sent} email${r.sent === 1 ? '' : 's'}.`)
      if (r.failed) toast.error(`${r.failed} failed. See the Failed tab for the reason and retry.`)
      if (r.skipped) toast.warning(`${r.skipped} skipped: ${skippedReasons.join('; ')}`)
      setConfirmIds(null)
      setSelected(new Set())
      await load()
      if (r.failed && !r.sent) setTab('failed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sending failed')
    } finally {
      setSending(false)
    }
  }

  async function createMissing() {
    setDrafting(true)
    const t = toast.loading(`Drafting 0/${missing.length}…`)
    const r = await syncDrafts(missing, (d) => toast.loading(`Drafting ${d}/${missing.length}…`, { id: t }))
    toast.success(`${r.drafted} draft${r.drafted === 1 ? '' : 's'} created${r.failed ? `, ${r.failed} failed` : ''}. Nothing has been sent.`, { id: t })
    setDrafting(false)
    load()
  }

  const confirmList = (emails ?? []).filter((e) => confirmIds?.includes(e.id))

  return (
    <>
      <PageHeader
        title="Outbox"
        description="Drafts wait here for you. Every email is editable, and nothing is sent until you click Send."
        actions={
          <>
            {missing.length > 0 && (
              <Button variant="outline" onClick={createMissing} disabled={drafting}>
                {drafting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                Draft {missing.length} missing
              </Button>
            )}
            {tab === 'drafts' && (
              <Button disabled={!selected.size || sending} onClick={() => setConfirmIds([...selected])}>
                <Send className="size-4" aria-hidden /> Send all selected{selected.size ? ` (${selected.size})` : ''}
              </Button>
            )}
          </>
        }
      />

      {testSender && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            No verified sender is set, so emails go from Resend's shared test address. Resend only delivers those to the
            Resend account owner's own inbox, so emails to candidates will fail until you verify a domain in Resend and add
            the sender address in Settings.
          </p>
        </div>
      )}
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList>
          <TabsTrigger value="drafts">Drafts ({groups.drafts.length})</TabsTrigger>
          <TabsTrigger value="sent">Sent ({groups.sent.length})</TabsTrigger>
          <TabsTrigger value="failed">Failed ({groups.failed.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {emails === null && !error ? (
        <div className="space-y-3"><Skeleton className="h-48 w-full" /><Skeleton className="h-48 w-full" /></div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={tab === 'drafts' ? 'No drafts' : tab === 'sent' ? 'Nothing sent yet' : 'No failed emails'}
          description={tab === 'drafts' ? 'Interview invites and rejection drafts appear here after you make a decision.' : tab === 'sent' ? 'Emails you send, with Resend delivery IDs, appear here.' : 'If Resend rejects an email, it appears here with the reason so you can fix and retry.'}
        />
      ) : (
        <>
          {tab === 'drafts' && selectableDrafts.length > 0 && (
            <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={selected.size > 0 && selected.size === selectableDrafts.length}
                onCheckedChange={(v) => setSelected(v === true ? new Set(selectableDrafts.map((e) => e.id)) : new Set())}
              />
              Select all sendable drafts
            </label>
          )}
          <div className="grid gap-4">
            {list.map((e) => (
              <EmailCard
                key={`${e.id}-${e.updated_at}`}
                email={e}
                selected={selected.has(e.id)}
                onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(e.id); else n.delete(e.id); return n })}
                selectable={tab === 'drafts' && sendable(e)}
                onSend={() => setConfirmIds([e.id])}
                onChanged={load}
              />
            ))}
          </div>
        </>
      )}

      <Dialog open={!!confirmIds} onOpenChange={(o) => !o && !sending && setConfirmIds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {confirmIds?.length} email{confirmIds?.length === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>These go to the candidates now and can't be unsent. Unsaved edits are not included, so save first.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-sm">
            {confirmList.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="truncate">{e.candidates?.display_label ?? 'Candidate'} <span className="text-muted-foreground">· {e.to_email}</span></span>
                <Badge variant="outline">{TYPE_LABEL[e.type]}</Badge>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmIds(null)} disabled={sending}>Cancel</Button>
            <Button onClick={() => confirmIds && send(confirmIds)} disabled={sending}>
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              Send {confirmIds?.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EmailCard({
  email, selected, selectable, onSelect, onSend, onChanged,
}: {
  email: Email
  selected: boolean
  selectable: boolean
  onSelect: (v: boolean) => void
  onSend: () => void
  onChanged: () => void
}) {
  const editable = email.status === 'draft' || email.status === 'failed'
  const [to, setTo] = useState(email.to_email ?? '')
  const [subject, setSubject] = useState(email.subject)
  const [body, setBody] = useState(email.body)
  const [saving, setSaving] = useState(false)
  const dirty = to !== (email.to_email ?? '') || subject !== email.subject || body !== email.body
  const words = body.trim().split(/\s+/).filter(Boolean).length
  const isDemo = !!email.candidates?.is_demo

  async function save() {
    setSaving(true)
    try {
      await updateDraft(email, { to_email: to.trim() || null, subject: subject.trim(), body })
      toast.success('Draft saved')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={cn('py-5', selected && 'ring-2 ring-primary/40')}>
      <CardContent className="grid gap-4 px-5">
        <div className="flex flex-wrap items-center gap-3">
          {selectable && <Checkbox checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Select email to ${email.candidates?.display_label}`} />}
          <span className="font-medium">{email.candidates?.display_label ?? 'Candidate'}</span>
          <Badge variant="outline" className={email.type === 'invite' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : ''}>{TYPE_LABEL[email.type]}</Badge>
          {isDemo && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">DEMO · can't be sent</Badge>}
          {email.edited_by_founder && <span className="text-xs text-muted-foreground">edited by you</span>}
          <span className="ml-auto text-xs text-muted-foreground">
            {email.status === 'sent' ? `Sent ${fmt(email.sent_at)}` : email.status === 'sending' ? 'Sending…' : `Drafted ${fmt(email.created_at)} · ${email.generated_by === 'template' ? 'from your template' : 'AI draft'}`}
          </span>
        </div>

        {email.status === 'failed' && (
          <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Attempt {email.attempts} failed: {email.last_error ?? 'Unknown error'}
          </p>
        )}
        {email.warnings.length > 0 && editable && (
          <ul className="grid gap-1 text-xs text-amber-800">{email.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        )}

        {editable ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${email.id}-to`}>To</Label>
                <Input id={`${email.id}-to`} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Add the candidate's email" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${email.id}-subject`}>Subject</Label>
                <Input id={`${email.id}-subject`} value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor={`${email.id}-body`}>Message</Label>
                <span className={cn('text-xs tabular-nums', words > (email.type === 'invite' ? 150 : 120) + 12 ? 'text-amber-800' : 'text-muted-foreground')}>
                  {words} words incl. signature
                </span>
              </div>
              <Textarea id={`${email.id}-body`} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" className="text-destructive" onClick={async () => {
                try { await discardDraft(email); toast.success('Draft discarded'); onChanged() } catch (e) { toast.error((e as Error).message) }
              }}>
                <Trash2 className="size-4" aria-hidden /> Discard
              </Button>
              <div className="flex gap-2">
                {dirty && <Button variant="outline" onClick={save} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" aria-hidden />} Save changes</Button>}
                <Button onClick={onSend} disabled={dirty || isDemo || !email.to_email}>
                  {email.status === 'failed' ? <RotateCw className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
                  {email.status === 'failed' ? 'Retry send' : 'Send'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="grid gap-2 text-sm">
            <p><span className="text-muted-foreground">To:</span> {email.to_email} <span className="text-muted-foreground">· From:</span> {email.from_email}</p>
            <p><span className="text-muted-foreground">Subject:</span> {email.subject}</p>
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-sm">{email.body}</pre>
            {email.resend_id && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-emerald-700" aria-hidden /> Accepted by Resend · ID {email.resend_id}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
