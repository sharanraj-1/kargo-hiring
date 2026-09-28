import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type SetupStatus = {
  jdsSaved: boolean
  referenceDocsAdded: boolean
  patternApproved: boolean
  cvsUploaded: boolean
}

export type Kpis = {
  totalApplicants: number
  scored: number
  awaitingDecision: number
  interviewsInvited: number
  respondedPct: number | null
  avgDaysWaiting: number | null
  daysRolesOpen: number | null
}

type CandidateRow = {
  id: string
  status: string
  decision_status: string
  applied_on: string | null
  uploaded_at: string
  first_responded_at: string | null
}

const DAY_MS = 86_400_000

function daysSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS))
}

export function useOverview() {
  const [data, setData] = useState<{ setup: SetupStatus; kpis: Kpis } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const [roles, jds, docs, patterns, candidates, invites] = await Promise.all([
        supabase.from('roles').select('id, opened_on').eq('is_active', true),
        supabase.from('job_descriptions').select('role_id').eq('status', 'saved'),
        supabase.from('reference_docs').select('id', { count: 'exact', head: true }),
        supabase.from('success_patterns').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
        supabase
          .from('candidates')
          .select('id, status, decision_status, applied_on, uploaded_at, first_responded_at')
          .returns<CandidateRow[]>(),
        supabase.from('emails').select('candidate_id').eq('type', 'invite').eq('status', 'sent'),
      ])
      const firstError = [roles, jds, docs, patterns, candidates, invites].find((r) => r.error)?.error
      if (firstError) {
        if (active) setError(firstError.message)
        return
      }

      const now = Date.now()
      const activeRoles = roles.data ?? []
      const savedRoleIds = new Set((jds.data ?? []).map((j) => j.role_id))
      const cands = candidates.data ?? []
      const waiting = cands.filter((c) => !c.first_responded_at)
      const openedDates = activeRoles.map((r) => r.opened_on).filter((d): d is string => !!d)

      const setup: SetupStatus = {
        jdsSaved: activeRoles.length > 0 && activeRoles.every((r) => savedRoleIds.has(r.id)),
        referenceDocsAdded: (docs.count ?? 0) > 0,
        patternApproved: (patterns.count ?? 0) > 0,
        cvsUploaded: cands.length > 0,
      }

      const kpis: Kpis = {
        totalApplicants: cands.length,
        scored: cands.filter((c) => c.status === 'scored').length,
        awaitingDecision: cands.filter((c) => c.status === 'scored' && c.decision_status === 'awaiting').length,
        interviewsInvited: new Set((invites.data ?? []).map((e) => e.candidate_id)).size,
        respondedPct: cands.length ? Math.round(((cands.length - waiting.length) / cands.length) * 100) : null,
        avgDaysWaiting: waiting.length
          ? Math.round(
              waiting.reduce((sum, c) => sum + daysSince(c.applied_on ?? c.uploaded_at, now), 0) / waiting.length,
            )
          : null,
        daysRolesOpen: openedDates.length
          ? Math.max(...openedDates.map((d) => daysSince(d, now)))
          : null,
      }

      if (active) setData({ setup, kpis })
    })()
    return () => {
      active = false
    }
  }, [])

  return { data, error }
}
