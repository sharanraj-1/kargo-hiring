// PII redaction. Runs before ANY text is sent to the model.
//
// Two levels:
// - 'ats':     strips personal identifiers (name, contact, links, location, DOB/age,
//              gender, marital status, nationality, religion).
// - 'pattern': also strips college and school names, to avoid pedigree bias in
//              Pattern Match scoring and success-pattern extraction.
//
// Pure TypeScript with no Deno/Node APIs, so it runs in Edge Functions and in local tests.

export type RedactionLevel = 'ats' | 'pattern'

export type RedactionResult = {
  text: string
  counts: Record<string, number>
}

export const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
// +91 98204 37810, 098204-37810, (022) 2345 6789, +1 415 555 0100
export const PHONE = /(?<![\w/])(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}(?![\w/])/g
// Social/profile domains always; any other domain only when written as a link (http(s):// or www.).
export const URL =
  /(?:\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|medium\.com|behance\.net|dribbble\.com|leetcode\.com|kaggle\.com|stackoverflow\.com|about\.me)|\bhttps?:\/\/|\bwww\.)[^\s|·,;]*/gi
const PERSONAL_LINE =
  /^[ \t]*(?:date of birth|d\.?o\.?b\.?|born|age|gender|sex|marital status|nationality|citizenship|religion|caste|father'?s name|mother'?s name|passport(?: no\.?)?|address|permanent address|current address)\b\s*[:\-–].*$/gim
const INLINE_PERSONAL =
  /\b(?:\d{1,2}\s*(?:years?|yrs?)\s*old|(?:un)?married|divorced|widowed|male|female|hindu|muslim|christian|sikh|jain|buddhist|indian national)\b/gi
const HONORIFIC = /\b(?:Mr|Mrs|Ms|Miss|Mx|Shri|Smt|Kumari)\.?\s+(?=\[NAME\]|[A-Z])/g

// Gendered pronouns reveal gender (e.g. inside quoted reviews); replace with neutral forms.
const PRONOUNS: Record<string, string> = {
  she: 'they', he: 'they', her: 'their', his: 'their', him: 'them', hers: 'theirs',
  herself: 'themself', himself: 'themself',
}
function neutralisePronouns(text: string, counts: Record<string, number>): string {
  return text.replace(/\b(she|he|her|his|him|hers|herself|himself)\b/gi, (m) => {
    counts.pronoun = (counts.pronoun ?? 0) + 1
    const out = PRONOUNS[m.toLowerCase()]
    return m[0] === m[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out
  })
}

const PINCODE =/\b\d{3}\s?\d{3}\b(?=\s*(?:$|[,|·]))/gm

// Indian cities/states plus common international hubs. Location is not a job signal.
export const PLACES = [
  'Mumbai', 'Navi Mumbai', 'Thane', 'Bombay', 'Pune', 'Bengaluru', 'Bangalore', 'Chennai', 'Madras', 'Hyderabad',
  'Secunderabad', 'Delhi', 'New Delhi', 'NCR', 'Delhi NCR', 'Gurgaon', 'Gurugram', 'Noida', 'Ghaziabad', 'Faridabad',
  'Kolkata', 'Calcutta', 'Ahmedabad', 'Surat', 'Vadodara', 'Jaipur', 'Lucknow', 'Kanpur', 'Indore', 'Bhopal', 'Nagpur',
  'Nashik', 'Kochi', 'Cochin', 'Thiruvananthapuram', 'Trivandrum', 'Coimbatore', 'Madurai', 'Tiruchirappalli',
  'Trichy', 'Calicut', 'Kozhikode', 'Mangalore', 'Mangaluru', 'Mysore', 'Mysuru', 'Manipal', 'Visakhapatnam',
  'Vijayawada', 'Bhubaneswar', 'Patna', 'Ranchi', 'Guwahati', 'Chandigarh', 'Mohali', 'Ludhiana', 'Amritsar',
  'Dehradun', 'Goa', 'Panaji', 'Jamshedpur', 'Raipur', 'Srinagar', 'Jammu', 'Udaipur', 'Jodhpur',
  'Maharashtra', 'Karnataka', 'Tamil Nadu', 'Kerala', 'Telangana', 'Andhra Pradesh', 'Gujarat', 'Rajasthan',
  'Uttar Pradesh', 'West Bengal', 'Haryana', 'Punjab', 'Madhya Pradesh', 'Odisha', 'Bihar', 'Assam', 'Jharkhand',
  'India', 'Dubai', 'Singapore', 'London', 'San Francisco', 'New York', 'Bay Area',
]

// Pedigree markers that can appear outside the education section.
const INSTITUTION_ACRONYMS = [
  'IIT', 'IITs', 'IIM', 'IIMs', 'NIT', 'NITs', 'IIIT', 'BITS', 'BITS Pilani', 'XLRI', 'ISB', 'NMIMS', 'SPJIMR',
  'IIFT', 'SRCC','VJTI', 'COEP', 'DTU', 'NSIT', 'IISc', 'JBIMS', 'SIBM', 'TISS', 'Ivy League',
]

const INSTITUTION_WORDS =
  /\b(?:[A-Z][\w.'&-]*\s+){0,6}(?:University|College|Institute|Institution|School(?! of Thought)|Academy|Polytechnic|Vidyalaya|Vidyapeeth|Mahavidyalaya)\b(?:\s+(?:of\s+)?(?:[A-Z][\w.'&-]*\s*){1,5})?/g

const INSTITUTION_TEST = new RegExp(INSTITUTION_WORDS.source)

const EDU_HEADING = /^[ \t]*(?:education|academic(?:s| background| qualifications)?|qualifications)[ \t]*:?[ \t]*$/im
const ANY_HEADING =
  /^[ \t]*(?:professional summary|summary|profile|experience|work experience|professional experience|employment|skills|technical skills|certifications?(?: & (?:skills|tools|other))?|projects|awards|achievements|publications|languages|interests|volunteering|references|tools)\b[^\n]{0,30}$/im

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceCounting(
  text: string,
  pattern: RegExp,
  token: string,
  key: string,
  counts: Record<string, number>,
): string {
  return text.replace(pattern, () => {
    counts[key] = (counts[key] ?? 0) + 1
    return token
  })
}

/** Degree / year / grade fragments that are kept inside education lines. */
const KEEP_EDU_SEGMENT =
  /^(?:(?:B|M)\.?\s?(?:E|Tech|Sc|Com|A|BA|Des|Arch|Pharm|S)\b.*|MBA.*|PGDM.*|PGPM.*|PGP.*|Ph\.?D.*|BBA.*|B\.B\.A\..*|BCA.*|MCA.*|LLB.*|CA\b.*|CFA\b.*|Diploma.*|\d{4}\s*[–-]\s*(?:\d{4}|present)|\(?part-time\)?|full-time|CGPA.*|GPA.*|\d+(?:\.\d+)?\s*%|first class.*|distinction|first division.*|second class.*|gold medal.*|.*\b(?:engineering|science|commerce|arts|economics|management|strategy|marketing|finance|psychology|business|design|law)\b.*)$/i

function redactEducationSection(text: string, counts: Record<string, number>): string {
  const start = text.search(EDU_HEADING)
  if (start < 0) return text
  const headingEnd = text.indexOf('\n', start)
  if (headingEnd < 0) return text
  const rest = text.slice(headingEnd + 1)
  const nextHeading = rest.search(ANY_HEADING)
  const sectionEnd = nextHeading < 0 ? text.length : headingEnd + 1 + nextHeading
  const section = text.slice(headingEnd + 1, sectionEnd)

  const cleaned = section
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line
      const parts = line.split(/\s*[|·•,]\s*|\s{3,}/).map((p) => p.trim()).filter(Boolean)
      return parts
        .map((p) => {
          if (KEEP_EDU_SEGMENT.test(p) && !INSTITUTION_TEST.test(p)) return p
          counts.institution = (counts.institution ?? 0) + 1
          return '[INSTITUTION]'
        })
        .join(' · ')
    })
    .join('\n')

  return text.slice(0, headingEnd + 1) + cleaned + text.slice(sectionEnd)
}

export function redact(input: string, opts: { level: RedactionLevel; knownNames?: string[] }): RedactionResult {
  const counts: Record<string, number> = {}
  let text = input

  // Contact details before names, so emails/handles containing a name are removed whole.
  text = replaceCounting(text, EMAIL, '[EMAIL]', 'email', counts)
  text = replaceCounting(text, URL, '[PROFILE_URL]', 'url', counts)

  // Known names (full name, then each part of 3+ letters), case-insensitive, whole words.
  for (const full of opts.knownNames ?? []) {
    const name = full.trim()
    if (!name) continue
    text = replaceCounting(text, new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), '[NAME]', 'name', counts)
    for (const part of name.split(/\s+/).filter((p) => p.length >= 3)) {
      text = replaceCounting(text, new RegExp(`\\b${escapeRegExp(part)}\\b`, 'gi'), '[NAME]', 'name', counts)
    }
  }

  text = replaceCounting(text, HONORIFIC, '', 'honorific', counts)
  text = neutralisePronouns(text, counts)
  text = replaceCounting(text, PERSONAL_LINE, '[PERSONAL_DETAIL]', 'personal_line', counts)
  text = replaceCounting(text, PHONE, '[PHONE]', 'phone', counts)
  text = replaceCounting(text, INLINE_PERSONAL, '[PERSONAL_DETAIL]', 'personal_inline', counts)

  const places = [...PLACES].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')
  text = replaceCounting(text, new RegExp(`\\b(?:${places})\\b`, 'g'), '[LOCATION]', 'location', counts)
  text = replaceCounting(text, PINCODE, '[LOCATION]', 'pincode', counts)

  if (opts.level === 'pattern') {
    text = redactEducationSection(text, counts)
    const acronyms = [...INSTITUTION_ACRONYMS].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')
    text = replaceCounting(
      text,
      new RegExp(`\\b(?:${acronyms})\\b(?:\\s+[A-Z][a-z]+)?`, 'g'),
      '[INSTITUTION]',
      'institution',
      counts,
    )
  }

  // Tidy: collapse runs of adjacent tokens and separators left behind.
  text = text
    .replace(/(\[(?:LOCATION|INSTITUTION)\])(?:[\s,/]*\1)+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')

  return { text, counts }
}

/** Words that must never drive a judgement. Used to flag model reasoning for review. */
export const BIAS_TERMS = [
  'college', 'university', 'alma mater', 'iit', 'iim', 'nit', 'bits', 'xlri', 'isb', 'pedigree', 'prestigious',
  'prestige', 'top-tier', 'tier-1', 'tier 1', 'elite', 'ivy', 'brand-name', 'big-name', 'faang', 'age', 'aged', 'young',
  'youthful', 'gender', 'male', 'female', 'woman', 'women', 'married', 'location', 'relocate', 'hometown',
  'nationality', 'religion',
]

export function findBiasTerms(text: string): string[] {
  const lower = text.toLowerCase()
  return BIAS_TERMS.filter((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`).test(lower))
}
