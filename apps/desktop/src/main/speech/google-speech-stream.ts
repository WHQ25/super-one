const GOOGLE_SPEECH_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_SAMPLE_RATE = 24_000

export interface GoogleSpeechChunk {
  bytes: Uint8Array
  sampleRate: number
}

/**
 * Gemini TTS streams over `:streamGenerateContent`. The installed
 * `@ai-sdk/google` speech model only calls unary `:generateContent`.
 */
export async function streamGoogleSpeech(options: {
  apiKey: string
  baseURL?: string
  modelId: string
  voice: string
  text: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  onChunk: (chunk: GoogleSpeechChunk) => void
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseURL = (options.baseURL?.replace(/\/$/, '') || GOOGLE_SPEECH_BASE_URL)
  const url = `${baseURL}/models/${encodeURIComponent(options.modelId)}:streamGenerateContent?alt=sse`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': options.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: options.text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } },
        },
      }),
      signal: options.signal,
    })
  } catch (error) {
    throw redactKey(error, options.apiKey)
  }
  if (!response.ok) {
    throw new Error(await googleSpeechError(response, options.apiKey))
  }
  let emitted = 0
  for await (const event of readServerEvents(response)) {
    if (options.signal?.aborted) return
    const errorMessage = eventError(event)
    if (errorMessage) throw new Error(redactText(errorMessage, options.apiKey))
    for (const chunk of audioChunks(event)) {
      emitted += 1
      options.onChunk(chunk)
    }
  }
  if (emitted === 0) throw new Error('No speech generated')
}

async function googleSpeechError(response: Response, apiKey: string): Promise<string> {
  const body = await response.text()
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
      return redactText(parsed.error.message, apiKey).slice(0, 500)
    }
  } catch {
    // The body is not a Gemini error envelope.
  }
  return `Google speech failed (${response.status})`
}

function redactKey(error: unknown, apiKey: string): Error {
  if (error instanceof Error && error.name === 'AbortError') return error
  const message = error instanceof Error ? error.message : String(error)
  return new Error(redactText(message, apiKey).slice(0, 500))
}

function redactText(value: string, apiKey: string): string {
  return apiKey ? value.split(apiKey).join('[redacted]') : value
}

async function* readServerEvents(response: Response): AsyncGenerator<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const payload = ssePayload(line)
      if (payload) yield payload
    }
  }
  const tail = ssePayload(buffer)
  if (tail) yield tail
}

function ssePayload(line: string): unknown | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return undefined
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return undefined
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return undefined
  }
}

function eventError(event: unknown): string | undefined {
  if (!event || typeof event !== 'object' || !('error' in event)) return undefined
  const error = (event as { error?: { message?: unknown } }).error
  return typeof error?.message === 'string' ? error.message : undefined
}

function audioChunks(event: unknown): GoogleSpeechChunk[] {
  const candidates = event && typeof event === 'object' && 'candidates' in event
    ? (event as { candidates?: unknown }).candidates
    : undefined
  if (!Array.isArray(candidates)) return []
  const chunks: GoogleSpeechChunk[] = []
  for (const candidate of candidates) {
    const parts = candidate && typeof candidate === 'object'
      ? (candidate as { content?: { parts?: unknown } }).content?.parts
      : undefined
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      const record = part as {
        inlineData?: { data?: unknown; mimeType?: unknown }
        inline_data?: { data?: unknown; mime_type?: unknown }
      }
      const inline = record.inlineData ?? record.inline_data
      const data = typeof inline?.data === 'string' ? inline.data : ''
      if (!data) continue
      const mime = record.inlineData?.mimeType ?? record.inline_data?.mime_type
      const sampleRate = typeof mime === 'string' ? sampleRateFromMime(mime) : DEFAULT_SAMPLE_RATE
      const bytes = pcmBytes(Uint8Array.from(Buffer.from(data, 'base64')))
      if (bytes.byteLength > 0) chunks.push({ bytes, sampleRate })
    }
  }
  return chunks
}

function sampleRateFromMime(mimeType: string): number {
  const match = /rate=(\d+)/.exec(mimeType)
  return match ? Number.parseInt(match[1]!, 10) : DEFAULT_SAMPLE_RATE
}

/** Streaming chunks are raw PCM. A unary-shaped WAV chunk keeps only its sample bytes. */
function pcmBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > 44 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return bytes.subarray(44)
  }
  return bytes
}
