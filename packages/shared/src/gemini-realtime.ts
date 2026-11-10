import type { VoiceDelegationKind } from './voice-delegation'
import { VOICE_DELEGATE_TOOL, VOICE_UPLINK_SAMPLE_RATE, buildVoiceInstructions } from './voice-delegation'

/**
 * Gemini Live WebSocket messages for the desktop spike.
 * The first frame is `setup`. Audio is base64 PCM. The key stays out of logs.
 */

export const GEMINI_LIVE_MODEL = 'gemini-3.8-live'

/** Prebuilt studio voices accepted by `gemini-3.8-live` speechConfig. */
export const GEMINI_LIVE_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const

export type GeminiLiveVoice = (typeof GEMINI_LIVE_VOICES)[number]

export const GEMINI_DEFAULT_VOICE: GeminiLiveVoice = 'Puck'

export function isGeminiLiveVoice(value: string): value is GeminiLiveVoice {
  return (GEMINI_LIVE_VOICES as readonly string[]).includes(value)
}

/**
 * Speech-to-text session used only for live captions.
 * `gemini-3.8-live` sends the user line after the speaker stops.
 * This model emits interim hypotheses while they are still talking.
 */
export const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live'
export const GEMINI_LIVE_SOCKET_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

/** Live tool runs in the background. The voice keeps listening while the backend works. */
export const GEMINI_DELEGATE_BEHAVIOR = 'NON_BLOCKING'
/** Speak the tool result after the current utterance. Do not talk over the user. */
export const GEMINI_RESULT_SCHEDULING = 'WHEN_IDLE'
/** The model called delegate_task again before the user said anything new. */
export const GEMINI_DELEGATE_REPEAT = 'Already handed to the backend agent. Stay silent. Do not call delegate_task again until the user speaks a new request.'
/** delegate_task arrived before any user speech was transcribed. */
export const GEMINI_DELEGATE_UNHEARD = 'No user speech has been transcribed yet. Stay silent. Call delegate_task again after the user has spoken.'

const SPIKE_INSTRUCTIONS = buildVoiceInstructions([
  'For any request that needs files, code, commands, the project, the browser, or the machine, briefly say, in the user\'s language, that it has started, then call it once. Do not say the work is finished. Do not add any other explanation.',
  'The result arrives later. Until then, add nothing of your own. Then tell the user what it says, in their language, in one or two short sentences. If the user speaks, answer them.',
])

export class GeminiFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeminiFrameError'
  }
}

export function geminiLiveSocketUrl(apiKey: string): string {
  const key = apiKey.trim()
  if (!key) throw new GeminiFrameError('Gemini API key is required.')
  const url = new URL(GEMINI_LIVE_SOCKET_URL)
  url.searchParams.set('key', key)
  return url.toString()
}

/** Drop a Live API key from a URL or an error string. */
export function redactGeminiText(value: string, apiKey?: string): string {
  let out = value.replace(/([?&]key=)[^&\s'"]+/gi, '$1[REDACTED]')
  const key = apiKey?.trim()
  if (key && key.length >= 4) out = out.split(key).join('[REDACTED]')
  return out
}

export function geminiDelegateDeclaration(): Record<string, unknown> {
  return {
    name: VOICE_DELEGATE_TOOL,
    behavior: GEMINI_DELEGATE_BEHAVIOR,
    description: 'Send the conversation between you and the user to the backend agent. No arguments. Do not write a task. Before calling, say one short sentence in the user\'s language that the work has started. Use this for anything you cannot do yourself. Never refuse and never say you cannot. Not for greetings or small talk.',
    parameters: { type: 'object', properties: {} },
  }
}

/** First WebSocket message. Model id is the documented Live example unless the caller overrides it. */
export function buildGeminiSetup(options: {
  model?: string
  instructions?: string
  /** Prebuilt studio voice. An unknown name uses `GEMINI_DEFAULT_VOICE`. */
  voice?: string
  /** Sliding-window compression so a call can outlive the 15 minute audio limit. */
  compressContext?: boolean
  /** Ask the server for a resumption handle. Pass one to continue the same call. */
  resume?: boolean
  resumptionHandle?: string
} = {}): Record<string, unknown> {
  const model = (options.model ?? GEMINI_LIVE_MODEL).trim()
  if (!model) throw new GeminiFrameError('Gemini model is required.')
  const voiceName = options.voice && isGeminiLiveVoice(options.voice) ? options.voice : GEMINI_DEFAULT_VOICE
  const setup: Record<string, unknown> = {
    model: model.startsWith('models/') ? model : `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
    systemInstruction: { parts: [{ text: options.instructions?.trim() || SPIKE_INSTRUCTIONS }] },
    tools: [{ functionDeclarations: [geminiDelegateDeclaration()] }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  }
  if (options.compressContext) setup.contextWindowCompression = { slidingWindow: {} }
  if (options.resume || options.resumptionHandle) {
    setup.sessionResumption = options.resumptionHandle ? { handle: options.resumptionHandle } : {}
  }
  return { setup }
}

/** Text-only live transcription. No tools and no spoken audio. */
export function buildGeminiTranscribeSetup(): Record<string, unknown> {
  return {
    setup: {
      model: `models/${GEMINI_TRANSCRIBE_MODEL}`,
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription: {},
    },
  }
}

/** One uplink chunk. PCM is 16-bit little-endian mono. */
export function geminiRealtimeAudio(pcm: Uint8Array, sampleRate = VOICE_UPLINK_SAMPLE_RATE): Record<string, unknown> {
  if (pcm.length === 0) throw new GeminiFrameError('Gemini audio chunk is empty.')
  return {
    realtimeInput: {
      audio: {
        data: Buffer.from(pcm).toString('base64'),
        mimeType: `audio/pcm;rate=${sampleRate}`,
      },
    },
  }
}

export function geminiRealtimeText(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) throw new GeminiFrameError('Gemini text input is empty.')
  return { realtimeInput: { text: trimmed } }
}

/** Backend text for the voice model to speak once it is idle. SILENT stores a result without speaking it. */
export function geminiToolResponse(calls: Array<{ id: string; name: string; result: string; scheduling?: string }>): Record<string, unknown> {
  if (calls.length === 0) throw new GeminiFrameError('Gemini tool response needs a call.')
  return {
    toolResponse: {
      functionResponses: calls.map(call => ({
        id: call.id,
        name: call.name,
        response: { result: call.result, scheduling: call.scheduling ?? GEMINI_RESULT_SCHEDULING },
      })),
    },
  }
}

export type GeminiPlaybackFrame = { type: 'pcm'; pcm: Uint8Array } | { type: 'drop' }

export interface GeminiFunctionCall {
  id: string
  name: string
  args: string
}

export type GeminiServerNotice =
  | { type: 'setup-complete' }
  | { type: 'audio'; pcm: Uint8Array; sampleRate: number }
  /** Low-latency hypothesis while the user is still talking. Each `text` replaces the preview. */
  | { type: 'input-interim'; text: string }
  /** Authoritative user transcription. Each `text` is a suffix of the finished line. */
  | { type: 'input-transcript'; text: string }
  | { type: 'output-transcript'; text: string }
  | { type: 'tool-call'; calls: GeminiFunctionCall[] }
  | { type: 'turn-complete' }
  | { type: 'interrupted' }
  | { type: 'resumption'; handle: string }
  | { type: 'go-away' }
  | { type: 'error'; message: string }
  | { type: 'ignored' }

/**
 * Live API frames often arrive on a binary WebSocket opcode.
 * The payload is still JSON. Anything else is reported by size and a short prefix.
 */
export function decodeGeminiServerFrame(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '')
  if (text.trimStart().startsWith('{')) return text
  const prefix = Buffer.from(bytes.subarray(0, 8)).toString('hex')
  throw new GeminiFrameError(`Gemini sent a binary frame (${bytes.byteLength} bytes, not JSON, prefix ${prefix}).`)
}

export function parseGeminiServerEvent(text: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new GeminiFrameError('Gemini event was not JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GeminiFrameError('Gemini event was not an object.')
  }
  return parsed as Record<string, unknown>
}

/** One socket message can carry audio, transcripts, and a tool call together. */
export function interpretGeminiServerEvent(event: Record<string, unknown>): GeminiServerNotice[] {
  const notices: GeminiServerNotice[] = []
  if ('setupComplete' in event || 'setup_complete' in event) notices.push({ type: 'setup-complete' })
  if ('goAway' in event || 'go_away' in event) notices.push({ type: 'go-away' })
  const resumption = record(event.sessionResumptionUpdate) ?? record(event.session_resumption_update)
  const handle = readString(resumption?.newHandle) ?? readString(resumption?.new_handle)
  if (handle) notices.push({ type: 'resumption', handle })

  const error = record(event.error)
  const errorMessage = readString(error?.message) ?? readString(event.error)
  if (errorMessage) notices.push({ type: 'error', message: redactGeminiText(errorMessage) })

  const content = record(event.serverContent) ?? record(event.server_content)
  if (content) {
    // Interim is the live caption. The final suffix and the turn close land
    // before a tool call in the same frame, so the handoff sees this speech.
    const interim = record(content.interimInputTranscription) ?? record(content.interim_input_transcription)
    const interimText = readString(interim?.text)
    if (interimText) notices.push({ type: 'input-interim', text: interimText })
    const transcription = record(content.inputTranscription) ?? record(content.input_transcription)
    const inputText = readString(transcription?.text)
    if (inputText) notices.push({ type: 'input-transcript', text: inputText })
    const output = record(content.outputTranscription) ?? record(content.output_transcription)
    const outputText = readString(output?.text)
    if (outputText) notices.push({ type: 'output-transcript', text: outputText })
    for (const audio of readAudioParts(content)) notices.push(audio)
    if (content.interrupted === true) notices.push({ type: 'interrupted' })
    if (content.turnComplete === true || content.turn_complete === true) notices.push({ type: 'turn-complete' })
  }

  const tool = record(event.toolCall) ?? record(event.tool_call)
  const calls = readFunctionCalls(tool?.functionCalls ?? tool?.function_calls)
  if (calls.length > 0) notices.push({ type: 'tool-call', calls })

  return notices.length > 0 ? notices : [{ type: 'ignored' }]
}

function readAudioParts(content: Record<string, unknown>): Array<Extract<GeminiServerNotice, { type: 'audio' }>> {
  const turn = record(content.modelTurn) ?? record(content.model_turn)
  const parts = turn?.parts
  if (!Array.isArray(parts)) return []
  const audio: Array<Extract<GeminiServerNotice, { type: 'audio' }>> = []
  for (const part of parts) {
    const inline = record(record(part)?.inlineData) ?? record(record(part)?.inline_data)
    const encoded = readString(inline?.data)
    if (!encoded) continue
    const pcm = decodeBase64(encoded)
    if (!pcm) continue
    audio.push({ type: 'audio', pcm, sampleRate: sampleRate(readString(inline?.mimeType) ?? readString(inline?.mime_type)) })
  }
  return audio
}

function readFunctionCalls(value: unknown): GeminiFunctionCall[] {
  if (!Array.isArray(value)) return []
  const calls: GeminiFunctionCall[] = []
  for (const item of value) {
    const call = record(item)
    const id = readString(call?.id)
    const name = readString(call?.name)
    if (!id || !name) continue
    calls.push({ id, name, args: argsText(call?.args) })
  }
  return calls
}

function argsText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return JSON.stringify(value)
  return ''
}

function sampleRate(mime: string | null): number {
  const match = mime?.match(/rate=(\d+)/)
  const rate = match ? Number(match[1]) : 24_000
  return Number.isFinite(rate) && rate > 0 ? rate : 24_000
}

function decodeBase64(value: string): Uint8Array | null {
  const normalized = value.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null
  const bytes = Buffer.from(normalized, 'base64')
  return bytes.length > 0 ? new Uint8Array(bytes) : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Live input/output transcription is incremental: each `text` is a new suffix,
 * not a full ASR hypothesis. Concatenate. If a later chunk already starts with
 * the current line, keep only the new tail.
 */
export function appendGeminiTranscript(current: string, incoming: string): { text: string; delta: string } | null {
  if (!incoming) return null
  if (!current) return { text: incoming, delta: incoming }
  if (incoming === current) return null
  if (incoming.startsWith(current)) {
    const delta = incoming.slice(current.length)
    return delta ? { text: incoming, delta } : null
  }
  if (current.startsWith(incoming)) return null
  return { text: current + incoming, delta: incoming }
}

/** Open user caption. `final` is the authoritative line. `interim` is only the live preview. */
export interface GeminiUserCaption {
  final: string
  interim: string
}

export interface GeminiCaptionChange {
  caption: GeminiUserCaption
  text: string
  /** This change opens the transcript item. */
  open: boolean
  /** The renderer replaces the line. Interim hypotheses and the first final after a preview do. */
  replace: boolean
  delta: string
}

/**
 * One interim hypothesis, as the Live API documents it: the latest text replaces
 * the preview. A final suffix already owns the line, so a late interim is ignored.
 */
export function noteGeminiInterim(caption: GeminiUserCaption, incoming: string): GeminiCaptionChange | null {
  if (!incoming.trim() || caption.final || incoming === caption.interim) return null
  const open = caption.interim.length === 0
  return {
    caption: { final: '', interim: incoming },
    text: incoming,
    open,
    replace: !open,
    delta: incoming,
  }
}

/** The first final after a preview replaces it. Later finals append as suffixes. */
export function noteGeminiFinal(caption: GeminiUserCaption, incoming: string): GeminiCaptionChange | null {
  const merged = appendGeminiTranscript(caption.final, incoming)
  if (!merged) return null
  const replace = caption.final.length === 0 && caption.interim.length > 0
  return {
    caption: { final: merged.text, interim: '' },
    text: merged.text,
    open: caption.final.length === 0 && caption.interim.length === 0,
    replace,
    delta: replace ? merged.text : merged.delta,
  }
}

export interface GeminiVoiceLine {
  role: 'user' | 'assistant'
  text: string
}

/** Spoken lines of one call. `sent` is how many have already gone to the backend. */
export interface GeminiVoiceLog {
  lines: GeminiVoiceLine[]
  sent: number
}

export function emptyGeminiVoiceLog(): GeminiVoiceLog {
  return { lines: [], sent: 0 }
}

/**
 * Keep one line per spoken turn. A later final that extends the previous
 * hypothesis of the same speaker replaces that line instead of repeating it.
 */
export function rememberGeminiVoiceLine(log: GeminiVoiceLog, role: 'user' | 'assistant', text: string): GeminiVoiceLog {
  const spoken = text.trim()
  if (!spoken) return log
  const last = log.lines[log.lines.length - 1]
  if (last?.role === role && last.text === spoken) return log
  if (last?.role === role && (spoken.startsWith(last.text) || last.text.startsWith(spoken))) {
    const lines = log.lines.slice()
    lines[lines.length - 1] = { role, text: spoken.length >= last.text.length ? spoken : last.text }
    return { lines, sent: log.sent }
  }
  return { lines: [...log.lines, { role, text: spoken }], sent: log.sent }
}

export interface GeminiDelegationHandoff {
  log: GeminiVoiceLog
  kind: VoiceDelegationKind
  transcript: GeminiVoiceLine[]
}

/** Open user turn as shown by the caption model. `interim` is only the unstable tail. */
export interface GeminiPartialCaption {
  committed: string
  interim: string
}

export function emptyGeminiPartialCaption(): GeminiPartialCaption {
  return { committed: '', interim: '' }
}

export interface GeminiPartialChange {
  caption: GeminiPartialCaption
  text: string
  open: boolean
  replace: boolean
  delta: string
}

/** The line on screen. A hypothesis that already starts with the committed text is not repeated. */
export function geminiPartialText(caption: GeminiPartialCaption): string {
  if (!caption.interim) return caption.committed
  if (!caption.committed || caption.interim.startsWith(caption.committed)) return caption.interim
  return caption.committed + caption.interim
}

/** Each interim hypothesis replaces the unstable tail while the speaker is still going. */
export function notePartialInterim(caption: GeminiPartialCaption, incoming: string): GeminiPartialChange | null {
  if (!incoming.trim() || incoming === caption.interim) return null
  const next = { committed: caption.committed, interim: incoming }
  const open = !caption.committed && !caption.interim
  return { caption: next, text: geminiPartialText(next), open, replace: !open, delta: geminiPartialText(next) }
}

/**
 * A finalized segment joins the stable line. A later segment that already
 * contains the line replaces it. A short suffix is appended.
 */
export function notePartialFinal(caption: GeminiPartialCaption, incoming: string): GeminiPartialChange | null {
  const segment = incoming.trim()
  if (!segment) return null
  const base = caption.committed
  const committed = !base
    ? segment
    : segment.startsWith(base)
      ? segment
      : base.endsWith(segment)
        ? base
        : base + segment
  if (committed === base && !caption.interim) return null
  const open = !base && !caption.interim
  return {
    caption: { committed, interim: '' },
    text: committed,
    open,
    replace: !open,
    delta: committed,
  }
}

/**
 * The record at this handoff. The first send is the whole call so far.
 * A later send is only the lines since that cursor, including the user line
 * still open. Nothing is sent when that slice has no new user speech.
 */
export function takeGeminiDelegation(log: GeminiVoiceLog, openUser: string): GeminiDelegationHandoff | null {
  const withOpen = rememberGeminiVoiceLine(log, 'user', openUser)
  const transcript = withOpen.lines.slice(withOpen.sent)
  if (!transcript.some(line => line.role === 'user')) return null
  return {
    log: { lines: withOpen.lines, sent: withOpen.lines.length },
    kind: withOpen.sent === 0 ? 'opening' : 'turn',
    transcript,
  }
}
