// Deterministic scoring (Section 5 of the brief). No model calls in here: the model supplies
// structure and quoted evidence; every number below is computed and explainable.

export type ExperienceEntry = { title: string; company: string | null; start: string | null; end: string | null }

export type Component = { key: string; label: string; score: number; max: number; explanation: string }

const round1 = (n: number) => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// Dates and product experience
// ---------------------------------------------------------------------------
/** 'YYYY-MM' -> months since year 0; 'present' -> today. Null if unparseable. */
export function monthIndex(value: string | null, today: Date): number | null {
  if (!value) return null
  if (/^present$/i.test(value.trim())) return today.getUTCFullYear() * 12 + today.getUTCMonth()
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return Number(m[1]) * 12 + (month - 1)
}

const PRODUCT_TITLE =
  /\b(product manager|product management|product owner|product lead|lead product|head of product|vp,? product|vice president,? product|director,? product|product director|chief product officer|cpo|group product manager|principal product manager|apm|associate product manager|senior pm|staff pm|pm)\b/i
// Titles that mention "product" but are not product management.
const NOT_PRODUCT_TITLE = /\b(product (designer|marketing|marketer|analyst|engineer|specialist|support|sales)|marketing)\b/i

export function isProductTitle(title: string): boolean {
  return PRODUCT_TITLE.test(title) && !NOT_PRODUCT_TITLE.test(title)
}

/** Years in product-management-titled roles, with overlapping periods counted once. */
export function productYears(entries: ExperienceEntry[], today: Date): { years: number; roles: string[] } {
  const intervals: [number, number][] = []
  const roles: string[] = []
  for (const e of entries) {
    if (!isProductTitle(e.title)) continue
    const s = monthIndex(e.start, today)
    const end = monthIndex(e.end ?? 'present', today)
    if (s === null || end === null || end < s) continue
    intervals.push([s, end + 1]) // inclusive end month
    roles.push(e.title)
  }
  intervals.sort((a, b) => a[0] - b[0])
  let months = 0
  let cur: [number, number] | null = null
  for (const iv of intervals) {
    if (!cur || iv[0] > cur[1]) {
      if (cur) months += cur[1] - cur[0]
      cur = [...iv]
    } else cur[1] = Math.max(cur[1], iv[1])
  }
  if (cur) months += cur[1] - cur[0]
  return { years: round1(months / 12), roles }
}

// ---------------------------------------------------------------------------
// ATS components
// ---------------------------------------------------------------------------
export function parsability(
  sections: { summary: boolean; experience: boolean; education: boolean; skills: boolean },
  entries: ExperienceEntry[],
  today: Date,
): Component {
  const sectionPts = (sections.experience ? 5 : 0) + (sections.education ? 2 : 0) + (sections.skills ? 2 : 0) + (sections.summary ? 1 : 0)
  const dated = entries.filter((e) => {
    const s = monthIndex(e.start, today)
    const end = monthIndex(e.end ?? null, today)
    return s !== null && end !== null && end >= s
  }).length
  const datePts = entries.length ? (dated / entries.length) * 5 : 0
  const missing = Object.entries(sections).filter(([, v]) => !v).map(([k]) => k)
  return {
    key: 'parsability',
    label: 'Parsability & structure',
    score: round1(sectionPts + datePts),
    max: 15,
    explanation:
      `Text extracted. Sections: ${missing.length ? `missing ${missing.join(', ')}` : 'all standard sections present'}. ` +
      `${dated} of ${entries.length} roles have consistent start/end dates.`,
  }
}

export type RequirementCredit = {
  id: string
  kind: 'must_have' | 'nice_to_have'
  text: string
  keyword_hit: string | null
  ai_status: 'met' | 'partial' | 'not_evidenced'
  quote: string | null
  credit: number // 0, 0.5 or 1
}

/** Whole-word, case-insensitive keyword search. Returns the first keyword found. */
export function keywordHit(text: string, keywords: string[]): string | null {
  const hay = text.toLowerCase()
  for (const k of keywords) {
    const kw = k.trim().toLowerCase()
    if (kw.length < 2) continue
    const re = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`)
    if (re.test(hay)) return k
  }
  return null
}

export function creditFor(keyword: string | null, aiStatus: RequirementCredit['ai_status'], quoteVerified: boolean): number {
  if (keyword) return 1
  if (!quoteVerified) return 0
  return aiStatus === 'met' ? 1 : aiStatus === 'partial' ? 0.5 : 0
}

export function keywordMatch(credits: RequirementCredit[]): Component {
  const musts = credits.filter((c) => c.kind === 'must_have')
  const nices = credits.filter((c) => c.kind === 'nice_to_have')
  const avg = (xs: RequirementCredit[]) => (xs.length ? xs.reduce((s, c) => s + c.credit, 0) / xs.length : 0)
  const ratio = nices.length ? 0.7 * avg(musts) + 0.3 * avg(nices) : avg(musts)
  const metMust = musts.filter((c) => c.credit === 1).length
  const metNice = nices.filter((c) => c.credit === 1).length
  return {
    key: 'keywords',
    label: 'Keyword & skill match',
    score: round1(30 * ratio),
    max: 30,
    explanation:
      `Must-haves: ${metMust} of ${musts.length} fully met` +
      (nices.length ? `; nice-to-haves: ${metNice} of ${nices.length}. Weighted 70/30.` : '. No nice-to-haves in this JD, so must-haves carry the full weight.'),
  }
}

export function experienceFit(years: number, min: number, max: number | null, roleTitles: string[]): Component {
  let score: number
  let why: string
  if (years < min) {
    score = min > 0 ? 25 * (years / min) : 25
    why = `${years} years of product management experience; the JD asks for ${min}${max ? `–${max}` : '+'}.`
  } else if (max !== null && years > max) {
    score = Math.max(15, 25 - 2.5 * (years - max))
    why = `${years} years, above the ${min}–${max} range for this role (may suit a more senior role).`
  } else {
    score = 25
    why = `${years} years, within the ${min}${max ? `–${max}` : '+'} years asked for.`
  }
  const basis = roleTitles.length ? ` Counted from: ${[...new Set(roleTitles)].join(', ')}.` : ' No product-management-titled roles found.'
  return { key: 'experience', label: 'Experience & level fit', score: round1(score), max: 25, explanation: why + basis }
}

export const IMPACT_FULL_MARKS = 5
export function quantifiedImpact(verifiedCount: number, totalBullets: number): Component {
  return {
    key: 'impact',
    label: 'Quantified impact',
    score: round1(20 * Math.min(1, verifiedCount / IMPACT_FULL_MARKS)),
    max: 20,
    explanation: `${verifiedCount} bullet${verifiedCount === 1 ? '' : 's'} with measurable outcomes (of ~${totalBullets}); ${IMPACT_FULL_MARKS}+ earns full marks.`,
  }
}

export function clarity(input: { hasEmail: boolean; hasPhone: boolean; textChars: number; totalBullets: number; entries: ExperienceEntry[] }): Component {
  const issues: string[] = []
  let pts = 0
  if (input.hasEmail) pts += 3; else issues.push('no email')
  if (input.hasPhone) pts += 2; else issues.push('no phone')
  if (input.textChars >= 1200) pts += 2; else issues.push('very short CV')
  if (input.totalBullets >= 3) pts += 1; else issues.push('few or no bullet points')
  if (input.entries.length > 0 && input.entries.every((e) => e.start)) pts += 2; else issues.push('roles without dates')
  return {
    key: 'clarity',
    label: 'Clarity & completeness',
    score: pts,
    max: 10,
    explanation: issues.length ? `Issues: ${issues.join(', ')}.` : 'Contact details present, dated roles, readable structure.',
  }
}

// ---------------------------------------------------------------------------
// Pattern, overall, tier
// ---------------------------------------------------------------------------
export function patternScore(scores: number[], signalCount: number): number {
  if (!signalCount) return 0
  return round1((scores.reduce((s, x) => s + x, 0) / (3 * signalCount)) * 100)
}

export type Settings = {
  ats_weight: number
  pattern_weight: number
  strong_threshold: number
  consider_threshold: number
  recommend_role_delta: number
}

export function overallScore(ats: number, pattern: number, s: Settings): number {
  return round1(ats * Number(s.ats_weight) + pattern * Number(s.pattern_weight))
}

export function tierFor(overall: number, s: Settings): 'strong_fit' | 'consider' | 'below_threshold' {
  if (overall >= Number(s.strong_threshold)) return 'strong_fit'
  if (overall >= Number(s.consider_threshold)) return 'consider'
  return 'below_threshold'
}
