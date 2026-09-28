import { FileText } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { JdCard } from '@/components/jd/JdCard'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { listRolesWithJds, type Role } from '@/lib/jobDescriptions'

export function JobDescriptionsPage() {
  const [roles, setRoles] = useState<Role[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRoles(await listRolesWithJds())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load job descriptions')
    }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <>
      <PageHeader
        title="Job descriptions"
        description="Paste or upload the JD for each role. Requirements are extracted for you to review, edit and save. Scoring only uses saved versions."
      />
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
      {roles === null && !error ? (
        <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      ) : roles && roles.length === 0 ? (
        <EmptyState icon={FileText} title="No open roles" description="Add a role to attach a job description." />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {roles?.map((r) => <JdCard key={r.id} role={r} onChanged={load} />)}
        </div>
      )}
    </>
  )
}
