import { useCallback, useEffect, useState } from 'react'
import type { Tier } from '@/lib/candidates'
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
  avgDaysToDecision: number | null
  overrideRate: number | null
  daysRolesOpen: number | null
}

export type AttentionItem = {
  id: string
  name: string
  isDemo: boolean
  kind: 'strong_awaiting' | 'waiting' | 'action'
  detail: string
  sortKey: number
}

type CandidateRow = {
  id: string
  display_label: string | null
  status: string
  decision_status: string
  is_demo: boolean
  applied_role_id: string
  applied_on: string | null
  uploaded_at: string
  first_responded_at: string | null
  decided_at: string | null
  needs_attention: string | null
  evaluations: { role_id: string; overall_score: number | null; tier: Tier | null; is_current: boolean }[]
}

const DAY_MS = 86_400_000
const daysBetween = (from: string, to: number) => Math.max(0, Math.floor((to - new Date(from).getTime()) / DAY_MS))
const appliedAt = (c: CandidateRow) => (c.applied_on ? `${c.applied_on}T00:00:00` : c.uploaded_at)
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

export function useOverview() {
  const [data, setData] = useState<{ setup: SetupStatus; kpis: Kpis; attention: AttentionItem[]; slaDays: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [roles, jds, docs, patterns, candidates, invites, decisions, settings] = await Promise.all([
      supabase.from('roles').select('id, opened_on').eq('is_active', true),
      supabase.from('job_descriptions').select('role_id').eq('status', 'saved'),
      supabase.from('reference_docs').select('id', { count: 'exact', head: true }),
      supabase.from('success_patterns').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase
        .from('candidates')
        .select('id, display_label, status, decision_status, is_demo, applied_role_id, applied_on, uploaded_at, first_responded_at, decided_at, needs_attention, evaluations(role_id, overall_score, tier, is_current)')
        .overrideTypes<CandidateRow[], { merge: false }>(),
      supabase.from('emails').select('candidate_id, candidates!inner(is_demo)').eq('type', 'invite').eq('status', 'sent').eq('candidates.is_demo', false),
      supabase.from('decisions').select('is_override, candidates!inner(is_demo)').eq('candidates.is_demo', false),
      supabase.from('settings').select('response_sla_days').eq('id', 1).single(),
    ])
    const firstError = [roles, jds, docs, patterns, candidates, invites, decisions, settings].find((r) => r.error)?.error
    if (firstError) return setError(firstError.message)

    const now = Date.now()
    const slaDays = settings.data?.response_sla_days ?? 7
    const activeRoles = roles.data ?? []
    const savedRoleIds = new Set((jds.data ?? []).map((j) => j.role_id))
    const all = candidates.data ?? []
    const real = all.filter((c) => !c.is_demo)
    const current = (c: CandidateRow) => c.evaluations.find((e) => e.is_current && e.role_id === c.applied_role_id)
    const unresponded = real.filter((c) => !c.first_responded_at)
    const decided = real.filter((c) => c.decided_at)
    const openedDates = activeRoles.map((r) => r.opened_on).filter((d): d is string => !!d)
    const decisionRows = decisions.data ?? []

    const kpis: Kpis = {
      totalApplicants: real.length,
      scored: real.filter((c) => c.status === 'scored').length,
      awaitingDecision: real.filter((c) => c.status === 'scored' && c.decision_status === 'awaiting').length,
      interviewsInvited: new Set((invites.data ?? []).map((e) => e.candidate_id)).size,
      respondedPct: real.length ? Math.round(((real.length - unresponded.length) / real.length) * 100) : null,
      avgDaysWaiting: avg(unresponded.map((c) => daysBetween(appliedAt(c), now))),
      avgDaysToDecision: avg(decided.map((c) => daysBetween(appliedAt(c), new Date(c.decided_at!).getTime()))),
      overrideRate: decisionRows.length ? Math.round((decisionRows.filter((d) => d.is_override).length / decisionRows.length) * 100) : null,
      daysRolesOpen: openedDates.length ? Math.max(...openedDates.map((d) => daysBetween(`${d}T00:00:00`, now))) : null,
    }

    const name = (c: CandidateRow) => c.display_label ?? 'Unnamed candidate'
    const strong: AttentionItem[] = all
      .filter((c) => c.status === 'scored' && c.decision_status === 'awaiting' && current(c)?.tier === 'strong_fit')
      .map((c) => ({ id: c.id, name: name(c), isDemo: c.is_demo, kind: 'strong_awaiting' as const, detail: `Strong Fit · ${current(c)!.overall_score?.toFixed(0)} · awaiting your decision`, sortKey: -(current(c)!.overall_score ?? 0) }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(0, 5)
    const strongIds = new Set(strong.map((s) => s.id))
    const waiting: AttentionItem[] = all
      .filter((c) => !c.first_responded_at && c.status !== 'unreadable' && daysBetween(appliedAt(c), now) > slaDays && !strongIds.has(c.id))
      .map((c) => {
        const days = daysBetween(appliedAt(c), now)
        const state = c.decision_status === 'move_forward' ? 'invite not sent yet' : c.decision_status === 'pass' ? 'rejection not sent yet' : 'no decision yet'
        return { id: c.id, name: name(c), isDemo: c.is_demo, kind: 'waiting' as const, detail: `Waiting ${days} days · ${state}`, sortKey: -days }
      })
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(0, 5)
    const action: AttentionItem[] = all
      .filter((c) => c.status === 'unreadable' || c.status === 'error')
      .map((c) => ({
        id: c.id, name: name(c), isDemo: c.is_demo, kind: 'action' as const, sortKey: 0,
        detail: c.status === 'unreadable' ? 'Unreadable CV – needs manual review' : c.needs_attention === 'name_not_found' ? 'Name not found – enter it to score' : 'Processing failed – retry',
      }))
      .slice(0, 5)

    setData({
      setup: {
        jdsSaved: activeRoles.length > 0 && activeRoles.every((r) => savedRoleIds.has(r.id)),
        referenceDocsAdded: (docs.count ?? 0) > 0,
        patternApproved: (patterns.count ?? 0) > 0,
        cvsUploaded: all.length > 0,
      },
      kpis,
      attention: [...strong, ...waiting, ...action],
      slaDays,
    })
    setError(null)
  }, [])

  useEffect(() => { load() }, [load])
  return { data, error, reload: load }
}
