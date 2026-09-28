import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { supabase } from '@/lib/supabase'

type AuditRow = { id: number; action: string; entity: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const humanise = (a: string) => a.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function summarise(d: Record<string, unknown>): string {
  return Object.entries(d ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
    .slice(0, 5)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80)}`)
    .join(' · ')
}

/** Every recorded action (uploads, AI runs, approvals, edits, sends), newest first. Read-only. */
export function ActivityLog() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('audit_log')
      .select('id, action, entity, entity_id, details, created_at')
      .order('created_at', { ascending: false })
      .limit(300)
      .overrideTypes<AuditRow[], { merge: false }>()
      .then(({ data, error }) => (error ? setError(error.message) : setRows(data ?? [])))
  }, [])

  function exportCsv() {
    if (!rows) return
    const esc = (v: unknown) => {
      const t = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const csv = ['created_at,action,entity,entity_id,details', ...rows.map((r) => [r.created_at, r.action, r.entity, r.entity_id, r.details].map(esc).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `kargo-activity-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!rows) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Latest {rows.length} actions. The log is append-only: entries can't be edited or deleted from the app.
        </p>
        <Button size="sm" variant="outline" onClick={exportCsv}><Download className="size-4" aria-hidden /> Export CSV</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Area</TableHead><TableHead>Details</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(r.created_at)}</TableCell>
                <TableCell className="whitespace-nowrap font-medium">{humanise(r.action)}</TableCell>
                <TableCell className="text-muted-foreground">{r.entity.replace(/_/g, ' ')}</TableCell>
                <TableCell className="max-w-xl truncate text-xs text-muted-foreground" title={JSON.stringify(r.details)}>{summarise(r.details)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
