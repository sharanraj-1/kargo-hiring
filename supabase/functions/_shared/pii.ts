// Deterministic PII extraction from a CV's raw text (no model involved).
// The result is stored in candidate_pii for the founder only; the name is then used to redact
// every other copy of the text. If the name can't be found confidently we say so; we never guess.
import { EMAIL, PHONE, PLACES, URL } from './redact.ts'

export type DetectedPii = {
  full_name: string | null
  email: string | null
  phone: string | null
  location: string | null
  profile_urls: string[]
  name_confidence: 'high' | 'none'
}

const NOT_A_NAME =
  /^(curriculum vitae|resume|résumé|cv|profile|professional summary|summary|contact|personal details|objective|about me|experience|education|skills)$/i
const NAME_WORD = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'-]*$/

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase())
}

function asName(segment: string): string | null {
  const s = segment.replace(/^name\s*[:\-–]\s*/i, '').trim()
  if (!s || s.length > 50 || NOT_A_NAME.test(s)) return null
  const words = s.split(/\s+/)
  if (words.length < 2 || words.length > 4) return null
  if (!words.every((w) => NAME_WORD.test(w))) return null
  // Reject job-title-like lines ("Product Manager", "Senior Product Manager").
  if (/\b(manager|engineer|lead|director|analyst|designer|developer|consultant|officer|head|intern|associate|executive|specialist)\b/i.test(s)) {
    return null
  }
  return s === s.toUpperCase() ? titleCase(s) : s
}

export function detectPii(raw: string): DetectedPii {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const head = lines.slice(0, 6)

  // Name: explicit "Name:" line anywhere, else the first header segment that looks like a person's name.
  let full_name: string | null = null
  const labelled = lines.find((l) => /^name\s*[:\-–]/i.test(l))
  if (labelled) full_name = asName(labelled)
  if (!full_name) {
    for (const line of head) {
      const first = line.split(/\s*[|·•,]\s*|\s{3,}/)[0]
      const candidate = asName(first)
      if (candidate) { full_name = candidate; break }
    }
  }

  const emails = raw.match(EMAIL) ?? []
  const phones = (raw.match(PHONE) ?? []).filter((p) => p.replace(/\D/g, '').length >= 10)
  const urls = [...new Set(raw.match(URL) ?? [])]

  // Location: the earliest place named on the contact line (the header line with an email or phone).
  const contactLine = head.find((l) => new RegExp(EMAIL.source, 'i').test(l) || new RegExp(PHONE.source).test(l)) ?? ''
  let location: string | null = null
  let best = Infinity
  for (const p of PLACES) {
    const idx = contactLine.search(new RegExp(`\\b${p}\\b`))
    if (idx >= 0 && (idx < best || (idx === best && p.length > (location?.length ?? 0)))) {
      best = idx
      location = p
    }
  }

  return {
    full_name,
    email: emails[0] ?? null,
    phone: phones[0]?.trim() ?? null,
    location,
    profile_urls: urls,
    name_confidence: full_name ? 'high' : 'none',
  }
}
