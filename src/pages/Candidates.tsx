import { Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CandidateTable } from '@/components/candidates/CandidateTable'
import { UploadPanel } from '@/components/candidates/UploadPanel'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  deleteDemoCandidates,
  listCandidates,
  listRoles,
  scoringReadiness,
  type CandidateRow,
  type Role,
} from '@/lib/candidates'
import { supabase } from '@/lib/supabase'

export function CandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [slaDays, setSlaDays] = useState(7)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDemo, setConfirmDemo] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, r, ready, s] = await Promise.all([
        listCandidates(),
        listRoles(),
        scoringReadiness(),
        supabase.from('settings').select('response_sla_days').eq('id', 1).single(),
      ])
      setCandidates(c)
      setRoles(r)
      if (s.data) setSlaDays(s.data.response_sla_days)
      setBlocked(
        !ready.patternApproved
          ? 'Approve a success pattern before uploading CVs.'
          : ready.rolesWithoutSavedJd.length
            ? `Save the job description for ${ready.rolesWithoutSavedJd.join(' and ')} before uploading CVs.`
            : null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load candidates')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const demoCount = candidates?.filter((c) => c.is_demo).length ?? 0

  return (
    <>
      <PageHeader
        title="Candidates"
        description="Upload CVs, then review the ranked list. The system recommends; you decide."
        actions={demoCount > 0 ? (
          <Button variant="outline" onClick={() => setConfirmDemo(true)}>
            <Trash2 className="size-4" aria-hidden /> Delete {demoCount} demo
          </Button>
        ) : undefined}
      />
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}

      {roles.length > 0 && <UploadPanel roles={roles} disabledReason={blocked} onProcessed={load} />}

      {candidates === null && !error ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : candidates && candidates.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No candidates yet"
          description={blocked ?? 'Upload CVs above. Each is parsed, redacted and scored against both roles.'}
          action={blocked ? <Button variant="outline" asChild><Link to={blocked.includes('pattern') ? '/reference-hires/pattern' : '/job-descriptions'}>Go to setup</Link></Button> : undefined}
        />
      ) : candidates ? (
        <CandidateTable candidates={candidates} roles={roles} slaDays={slaDays} onChanged={load} />
      ) : null}

      <Dialog open={confirmDemo} onOpenChange={setConfirmDemo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {demoCount} demo candidate{demoCount === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              Removes every candidate marked DEMO, with their files, scores and evidence. Real candidates are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDemo(false)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              try {
                const n = await deleteDemoCandidates()
                toast.success(`Deleted ${n} demo candidate${n === 1 ? '' : 's'}`)
                setConfirmDemo(false)
                load()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not delete')
              }
            }}>Delete demo data</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
