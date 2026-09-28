import { Settings as SettingsIcon } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Scoring weights, tier thresholds, email templates and sender details."
      />
      <EmptyState
        icon={SettingsIcon}
        title="Settings arrive in Phase 6"
        description="Defaults are in place: ATS 40% / Pattern 60%, Strong Fit at 75 or above, Consider at 55 to 74, response SLA 7 days."
      />
    </>
  )
}
