import { ShieldAlert } from 'lucide-react'
import { lazy, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { LoginPage } from '@/pages/Login'

// Each screen is its own chunk, so the first load stays small.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))
const OverviewPage = page(() => import('@/pages/Overview'), 'OverviewPage')
const JobDescriptionsPage = page(() => import('@/pages/JobDescriptions'), 'JobDescriptionsPage')
const ReferenceHiresPage = page(() => import('@/pages/ReferenceHires'), 'ReferenceHiresPage')
const SuccessPatternPage = page(() => import('@/pages/SuccessPattern'), 'SuccessPatternPage')
const CandidatesPage = page(() => import('@/pages/Candidates'), 'CandidatesPage')
const BelowThresholdPage = page(() => import('@/pages/BelowThreshold'), 'BelowThresholdPage')
const OutboxPage = page(() => import('@/pages/Outbox'), 'OutboxPage')
const DecisionLogPage = page(() => import('@/pages/DecisionLog'), 'DecisionLogPage')
const SettingsPage = page(() => import('@/pages/Settings'), 'SettingsPage')

function FullPageLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-40" />
    </div>
  )
}

function PageLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-96 max-w-full" /><Skeleton className="h-64 w-full" />
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

function Screen({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </ErrorBoundary>
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
          <Route index element={<Screen><OverviewPage /></Screen>} />
          <Route path="job-descriptions" element={<Screen><JobDescriptionsPage /></Screen>} />
          <Route path="reference-hires" element={<Screen><ReferenceHiresPage /></Screen>} />
          <Route path="reference-hires/pattern" element={<Screen><SuccessPatternPage /></Screen>} />
          <Route path="candidates" element={<Screen><CandidatesPage /></Screen>} />
          <Route path="below-threshold" element={<Screen><BelowThresholdPage /></Screen>} />
          <Route path="outbox" element={<Screen><OutboxPage /></Screen>} />
          <Route path="decision-log" element={<Screen><DecisionLogPage /></Screen>} />
          <Route path="settings" element={<Screen><SettingsPage /></Screen>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
