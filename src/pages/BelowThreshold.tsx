import { ListChecks } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'

export function BelowThresholdPage() {
  return (
    <>
      <PageHeader
        title="Review below threshold"
        description="Candidates scoring below the threshold. Nobody here is rejected or emailed until you confirm."
      />
      <EmptyState
        icon={ListChecks}
        title="No candidates below threshold"
        description="Scored candidates under the threshold will be listed here with a one-line reason, for you to confirm or override."
      />
    </>
  )
}
