// One-off bulk import of reference-hire CVs from a local folder.
// Does the same as uploading in the dashboard: stores each file in the private
// `reference_docs` bucket and saves its extracted text. Matching is by filename
// (e.g. cv_07_lavanya_iyer.docx -> "Lavanya Iyer"); anything ambiguous is skipped, never guessed.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-reference-cvs.mjs <folder>
import { createClient } from '@supabase/supabase-js'
import mammoth from 'mammoth'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const MIN_READABLE_CHARS = 300 // keep in sync with src/lib/extract.ts
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const dir = process.argv[2]
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !dir) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-reference-cvs.mjs <folder>')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Same normalisation as the browser extractor.
const normalise = (t) =>
  t.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const { data: hires, error } = await db.from('reference_hires').select('id, name, reference_docs(file_name)')
if (error) throw error

for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.docx')).sort()) {
  const base = slug(file.replace(/\.docx$/i, ''))
  const matches = hires.filter((h) => base.endsWith(slug(h.name)))
  if (matches.length !== 1) {
    console.log(`SKIP  ${file}: ${matches.length === 0 ? 'no matching hire' : 'ambiguous match'}`)
    continue
  }
  const hire = matches[0]
  if (hire.reference_docs.some((d) => d.file_name === file)) {
    console.log(`SKIP  ${file}: already uploaded for ${hire.name}`)
    continue
  }

  const buffer = fs.readFileSync(path.join(dir, file))
  const text = normalise((await mammoth.extractRawText({ buffer })).value)
  const readable = text.length >= MIN_READABLE_CHARS
  const firstLine = text.split('\n')[0] ?? ''
  if (slug(firstLine) !== slug(hire.name)) {
    console.log(`SKIP  ${file}: first line "${firstLine.slice(0, 40)}" does not match ${hire.name}`)
    continue
  }

  const storagePath = `${hire.id}/${randomUUID()}-${file.replace(/[^\w.-]+/g, '_')}`
  const up = await db.storage.from('reference_docs').upload(storagePath, buffer, { contentType: DOCX, upsert: false })
  if (up.error) {
    console.log(`FAIL  ${file}: ${up.error.message}`)
    continue
  }
  const ins = await db
    .from('reference_docs')
    .insert({
      reference_hire_id: hire.id,
      storage_path: storagePath,
      file_name: file,
      mime_type: DOCX,
      size_bytes: buffer.length,
      extracted_text: readable ? text : null,
      text_chars: text.length,
      is_readable: readable,
    })
    .select('id')
    .single()
  if (ins.error) {
    await db.storage.from('reference_docs').remove([storagePath])
    console.log(`FAIL  ${file}: ${ins.error.message}`)
    continue
  }
  await db.from('audit_log').insert({
    action: 'reference_doc_uploaded',
    entity: 'reference_hires',
    entity_id: hire.id,
    details: { doc_id: ins.data.id, file_name: file, chars: text.length, readable, source: 'bulk import script' },
  })
  console.log(`OK    ${file} -> ${hire.name} (${text.length} chars${readable ? '' : ', UNREADABLE'})`)
}
