// Text extraction for uploaded documents, run in the founder's browser.
// PDF -> pdf.js, DOCX -> mammoth, TXT -> plain text.
// Anything under MIN_READABLE_CHARS (e.g. a scanned image PDF) is marked unreadable:
// it is never guessed at or sent for scoring.

export const MIN_READABLE_CHARS = 300
export const MAX_FILE_BYTES = 10 * 1024 * 1024

export const ACCEPTED_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/plain': 'TXT',
}
export const ACCEPT_ATTR = '.pdf,.docx,.txt,' + Object.keys(ACCEPTED_TYPES).join(',')

export type Extraction = {
  text: string
  chars: number
  readable: boolean
}

/** Browsers sometimes report an empty MIME type; fall back to the extension. */
export function resolveMimeType(file: File): string | null {
  if (ACCEPTED_TYPES[file.type]) return file.type
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === 'txt') return 'text/plain'
  return null
}

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const doc = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let pageText = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        pageText += item.str + (item.hasEOL ? '\n' : ' ')
      }
      pages.push(pageText)
    }
    return pages.join('\n\n')
  } finally {
    await task.destroy()
  }
}

async function extractDocx(file: File): Promise<string> {
  const { default: mammoth } = await import('mammoth/mammoth.browser')
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value
}

export async function extractText(file: File): Promise<Extraction> {
  const mime = resolveMimeType(file)
  if (!mime) throw new Error('Unsupported file type. Use PDF, DOCX or TXT.')
  if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than 10 MB.')

  const raw =
    mime === 'application/pdf' ? await extractPdf(file) :
    mime === 'text/plain' ? await file.text() :
    await extractDocx(file)

  const text = normalise(raw)
  return { text, chars: text.length, readable: text.length >= MIN_READABLE_CHARS }
}
