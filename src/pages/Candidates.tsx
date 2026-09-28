import { Users } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'

export function CandidatesPage() {
  return (
    <>
      <PageHeader
        title="Candidates"
        description="Upload CVs, then review the ranked list. The system recommends; you decide."
      />
      <EmptyState
        icon={Users}
        title="No candidates yet"
        description="Upload CVs once the job descriptions are saved and the success pattern is approved."
      />
    </>
  )
}
