import { Mail } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'

export function OutboxPage() {
  return (
    <>
      <PageHeader
        title="Outbox"
        description="Draft emails wait here. Nothing is sent until you click Send."
      />
      <EmptyState
        icon={Mail}
        title="No drafts"
        description="Interview invites and rejection drafts appear here after you make a decision."
      />
    </>
  )
}
