import { ShieldAlert } from 'lucide-react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { BelowThresholdPage } from '@/pages/BelowThreshold'
import { CandidatesPage } from '@/pages/Candidates'
import { DecisionLogPage } from '@/pages/DecisionLog'
import { JobDescriptionsPage } from '@/pages/JobDescriptions'
import { LoginPage } from '@/pages/Login'
import { OutboxPage } from '@/pages/Outbox'
import { OverviewPage } from '@/pages/Overview'
import { ReferenceHiresPage } from '@/pages/ReferenceHires'
import { SettingsPage } from '@/pages/Settings'
import { SuccessPatternPage } from '@/pages/SuccessPattern'

function FullPageLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-40" />
    </div>
  )
}

function Unauthorised({ email }: { email: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <ShieldAlert className="mx-auto mb-4 size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-base font-semibold">This account does not have access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {email} is signed in, but is not the founder account for this dashboard.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  )
}

export default function App() {
  const auth = useAuth()

  if (auth.status === 'loading') return <FullPageLoading />
  if (auth.status === 'signed_out') return <LoginPage />
  if (auth.status === 'unauthorised') return <Unauthorised email={auth.session.user.email ?? 'This account'} />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell email={auth.session.user.email ?? ''} />}>
          <Route index element={<OverviewPage />} />
          <Route path="job-descriptions" element={<JobDescriptionsPage />} />
          <Route path="reference-hires" element={<ReferenceHiresPage />} />
          <Route path="reference-hires/pattern" element={<SuccessPatternPage />} />
          <Route path="candidates" element={<CandidatesPage />} />
          <Route path="below-threshold" element={<BelowThresholdPage />} />
          <Route path="outbox" element={<OutboxPage />} />
          <Route path="decision-log" element={<DecisionLogPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
