// One-off import of job descriptions as DRAFT versions, then AI extraction.
// Matches files to roles by title in the filename ("...Senior Product Manager.docx" -> SPM).
// The founder still reviews and saves each JD in the dashboard.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-jds.mjs <file.docx> [...]
import { createClient } from '@supabase/supabase-js'
import mammoth from 'mammoth'
import path from 'node:path'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const files = process.argv.slice(2)
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !files.length) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-jds.mjs <file.docx> [...]')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const normalise = (t) =>
  t.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()

const { data: roles, error } = await db.from('roles').select('id, code, title')
if (error) throw error
// Longest title first so "Senior Product Manager" wins over "Product Manager".
const byTitle = [...roles].sort((a, b) => b.title.length - a.title.length)

for (const file of files) {
  const name = path.basename(file)
  const role = byTitle.find((r) => name.toLowerCase().includes(r.title.toLowerCase()))
  if (!role) { console.log(`SKIP  ${name}: no matching role`); continue }

  const text = normalise((await mammoth.extractRawText({ path: file })).value)
  const { data: last } = await db.from('job_descriptions').select('version').eq('role_id', role.id)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const { data: jd, error: insErr } = await db.from('job_descriptions')
    .insert({ role_id: role.id, version: (last?.version ?? 0) + 1, status: 'draft', source_text: text, source_file_name: name })
    .select('id, version').single()
  if (insErr) { console.log(`FAIL  ${name}: ${insErr.message}`); continue }
  await db.from('audit_log').insert({ action: 'job_description_created', entity: 'job_descriptions', entity_id: jd.id,
    details: { role: role.code, version: jd.version, file_name: name, source: 'import script' } })

  const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-jd-requirements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jd_id: jd.id }),
  })
  const out = await res.json()
  console.log(res.ok ? `OK    ${name} -> ${role.code} v${jd.version}: ${JSON.stringify(out.counts)} years=${JSON.stringify(out.years)}` : `FAIL  ${name} extraction: ${out.error}`)
  for (const w of out.warnings ?? []) console.log(`      ! ${w}`)
}
