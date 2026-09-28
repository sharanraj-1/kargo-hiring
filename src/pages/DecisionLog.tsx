import { ScrollText } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'

export function DecisionLogPage() {
  return (
    <>
      <PageHeader
        title="Decision log"
        description="Every decision, the AI recommendation it was made against, and your reasoning."
      />
      <EmptyState
        icon={ScrollText}
        title="No decisions logged"
        description="Decisions you make on candidates are recorded here with a timestamp and optional reason."
      />
    </>
  )
}
