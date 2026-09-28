// Gemini client for Edge Functions. Server-side only: the key never reaches the browser.
// Uses the REST generateContent endpoint with a JSON Schema response format,
// then validates the parsed output with Zod before anything is stored.
import type { z } from 'npm:zod@4.6.5'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export function geminiModel(): string {
  const model = Deno.env.get('GEMINI_MODEL')
  if (!model) throw new Error('GEMINI_MODEL is not set')
  return model
}

export class GeminiError extends Error {}

type GenerateOptions<T> = {
  system: string
  prompt: string
  /** JSON Schema sent to Gemini as responseJsonSchema. */
  jsonSchema: Record<string, unknown>
  /** Zod schema the parsed response must satisfy. */
  validator: z.ZodType<T>
  temperature?: number
  timeoutMs?: number
}

export async function generateJson<T>(opts: GenerateOptions<T>): Promise<{ data: T; model: string; usage: unknown }> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY is not set')
  const model = geminiModel()

  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema: opts.jsonSchema,
      },
    }),
  })

  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = body?.error?.message ?? `HTTP ${res.status}`
    throw new GeminiError(`Gemini request failed: ${message}`)
  }

  const candidate = body?.candidates?.[0]
  if (!candidate) {
    throw new GeminiError(`Gemini returned no candidates (${body?.promptFeedback?.blockReason ?? 'no reason given'})`)
  }
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new GeminiError(`Gemini stopped early: ${candidate.finishReason}`)
  }
  const text = (candidate.content?.parts ?? [])
    .filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === 'string')
    .map((p: { text: string }) => p.text)
    .join('')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new GeminiError('Gemini returned invalid JSON')
  }
  const result = opts.validator.safeParse(parsed)
  if (!result.success) {
    throw new GeminiError(`Gemini output failed validation: ${result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  return { data: result.data, model: body?.modelVersion ?? model, usage: body?.usageMetadata ?? null }
}

/** Normalise for verbatim-quote checks: whitespace, dashes, quotes, bullets. */
function normaliseForMatch(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[▪•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** True only if the quote appears verbatim (modulo whitespace/punctuation variants) in the source. */
export function quoteIsVerbatim(quote: string | null | undefined, source: string): boolean {
  if (!quote) return false
  const src = normaliseForMatch(source)
  // An ellipsis joins fragments; every fragment must appear verbatim.
  const fragments = normaliseForMatch(quote)
    .replace(/^["']|["']$/g, '')
    .split(/\s*(?:\.{3}|…)\s*/)
    .map((f) => f.trim())
    .filter(Boolean)
  if (!fragments.length || fragments.join('').length < 8) return false
  return fragments.every((f) => src.includes(f))
}
