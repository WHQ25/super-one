import { redactVoiceText } from './realtime-voice'
import { formatRealtimeDelegation, parseRealtimeDelegation, type RealtimeTranscriptLine } from './realtime-timeline'

/**
 * Doubao Seeduplex realtime dialog.
 *
 * One WebSocket text frame is one JSON event. Audio rides inside the JSON as
 * base64. The socket authenticates with a single X-Api-Key from the Doubao
 * speech console. Input is 16 kHz mono PCM s16le in 20 ms packets. Output is
 * requested as 24 kHz pcm_s16le.
 */

export const DOUBAO_REALTIME_URL = 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue'
export const DOUBAO_SEEDUPLEX_MODEL = '1.2.6.1'
export const DOUBAO_DEFAULT_SPEAKER = 'zh_female_vv_jupiter_bigtts'
export const DOUBAO_UPLINK_SAMPLE_RATE = 16_000
export const DOUBAO_UPLINK_FRAME_BYTES = 640
/** One uplink frame is 20 ms. Frames go out while the user is speaking, at this rate. */
export const DOUBAO_UPLINK_FRAME_MS = 20
/** Bound how long a stalled pacer can keep the server from hearing the latest audio. */
export const DOUBAO_UPLINK_MAX_QUEUED_FRAMES = 25
export const DOUBAO_DOWNLINK_SAMPLE_RATE = 24_000
export const DOUBAO_ACK_TEXT = '好，我来处理'
export const DOUBAO_FALLBACK_SPOKEN = '做完了'
export const DOUBAO_DELEGATE_TOOL = 'delegate_task'
/** Spoken agent replies stop here so a long write-up does not become a monologue. */
export const DOUBAO_SPEAKABLE_CHARS = 1200
/** Shown in the bubble when the call ends. The preamble tells the agent not to answer it. */
export const DOUBAO_VOICE_ENDED_INPUT = '语音会话已结束。'

/** First message of a call, including a resumed call. The transcript is what the user just said. */
export const DOUBAO_VOICE_OPENING_PREAMBLE = [
  'The user just started a voice session.',
  'This is their first message. The transcript is what they said, in their words. Do that.',
  'Reply in a colloquial, concise way, in the user\'s language.',
  'Tables and code may stay in the reply. The voice transcript shows them, and only the prose is read aloud.',
  'Do not mention the voice layer.',
  'If they only greeted you and asked for nothing, do not reply.',
].join(' ')

export const DOUBAO_DELEGATION_PREAMBLE = [
  'This request is from the open voice session.',
  'The transcript is what the user just said, in their words. Do that.',
  'Reply in a colloquial, concise way, in the user\'s language.',
  'Tables and code may stay in the reply. The voice transcript shows that reply. Only the prose is read aloud.',
  'Do not mention the voice layer.',
].join(' ')

export const DOUBAO_VOICE_ENDED_PREAMBLE = [
  'The voice session has ended.',
  'Do not reply to this notice.',
  'Later replies can be normal written answers.',
].join(' ')

export type DoubaoDelegationKind = 'opening' | 'turn' | 'ended'

/**
 * The backing-thread turn for one spoken delegation, in the Codex envelope.
 * The bubble shows the user's words. The preamble sits outside `<input>`.
 * `opening` is the first delegate of a call. `ended` marks hangup.
 */
export function doubaoDelegationContent(
  utterance: string,
  transcript: readonly RealtimeTranscriptLine[] = [],
  kind: DoubaoDelegationKind = 'turn',
): string {
  const preamble = kind === 'opening'
    ? DOUBAO_VOICE_OPENING_PREAMBLE
    : kind === 'ended'
      ? DOUBAO_VOICE_ENDED_PREAMBLE
      : DOUBAO_DELEGATION_PREAMBLE
  const instruction = kind === 'ended'
    ? (utterance.trim() || DOUBAO_VOICE_ENDED_INPUT)
    : utterance.trim()
  return formatRealtimeDelegation({
    preamble,
    instruction,
    transcript,
  })
}

export const DOUBAO_O2_SPEAKERS = [
  'zh_female_vv_jupiter_bigtts',
  'zh_female_xiaohe_jupiter_bigtts',
  'zh_male_yunzhou_jupiter_bigtts',
  'zh_male_xiaotian_jupiter_bigtts',
  'en_male_tim_uranus_bigtts',
  'en_female_dacey_uranus_bigtts',
  'en_female_stokie_uranus_bigtts',
] as const

export type DoubaoO2Speaker = (typeof DOUBAO_O2_SPEAKERS)[number]

const MAX_SPOKEN_CHARS = 600
const SPOKEN_TAG = /<spoken>([\s\S]*?)<\/spoken>/gi

export class DoubaoFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DoubaoFrameError'
  }
}

export type DoubaoServerNotice =
  | { type: 'session-started'; dialogId: string }
  | { type: 'session-updated' }
  | { type: 'session-finished' }
  | { type: 'usage' }
  | { type: 'asr-info' }
  | { type: 'asr'; text: string; interim: boolean }
  | { type: 'asr-ended'; text: string }
  | { type: 'asr-failed'; message: string }
  | { type: 'chat'; content: string }
  | { type: 'chat-ended' }
  | { type: 'tts-start'; text: string; ttsType?: string }
  | { type: 'tts-audio'; pcm: Uint8Array }
  | { type: 'tts-ended'; statusCode?: string; exitIntent: boolean }
  | { type: 'error'; code?: string; message: string; retryable: boolean }
  | { type: 'response-canceled' }
  | { type: 'function-calls'; calls: DoubaoFunctionCall[] }
  | { type: 'ignored'; event?: string }

export interface DoubaoFunctionCall {
  callId: string
  name: string
  arguments: string
}

export interface DoubaoStartSessionOptions {
  speaker?: string
  speechRate?: number
  dialogId?: string
  eventId?: string
}

export function doubaoConnectionHeaders(input: { apiKey: string }): Record<string, string> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new DoubaoFrameError('Doubao API key is required.')
  return { 'X-Api-Key': apiKey }
}

export function isDoubaoO2Speaker(value: string): value is DoubaoO2Speaker {
  return (DOUBAO_O2_SPEAKERS as readonly string[]).includes(value)
}

const VOICE_ASIDE = /等待|安静|按要求|静默|别说|不要说|stay silent|stay quiet|as instructed|waiting|keep quiet|do not speak/i

/**
 * Parenthetical stage directions are not part of the spoken line.
 * A note after a finished sentence, or one that only says to wait and be quiet, is dropped.
 * An unclosed parenthesis at the end stays hidden until the model finishes it.
 */
export function stripVoiceAsides(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const open = text.slice(index).search(/[（(]/)
    if (open < 0) {
      out += text.slice(index)
      break
    }
    const start = index + open
    const close = text.slice(start + 1).search(/[）)]/)
    if (close < 0) {
      out += text.slice(index, start)
      break
    }
    const end = start + 1 + close
    const before = text.slice(index, start)
    const interior = text.slice(start + 1, end)
    if (VOICE_ASIDE.test(interior) || /[。！？!?]\s*$/.test(before)) out += before.replace(/[ \t]+$/, '')
    else out += text.slice(index, end + 1)
    index = end + 1
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '')
}

/** One tool: hand project work to the session agent. Small talk stays with Doubao. */
export function doubaoDelegateTool(): Record<string, unknown> {
  return {
    type: 'function',
    name: DOUBAO_DELEGATE_TOOL,
    description: 'Send the conversation between you and the user to the backend agent. No arguments. Do not write a task. Not for greetings or small talk.',
    parameters: {
      type: 'object',
      properties: {},
    },
  }
}

/** session.create for the Seeduplex voice shell. */
export function buildDoubaoStartSession(options: DoubaoStartSessionOptions = {}): Record<string, unknown> {
  const speaker = options.speaker ?? DOUBAO_DEFAULT_SPEAKER
  if (!isDoubaoO2Speaker(speaker)) throw new DoubaoFrameError('Doubao speaker is not a Seeduplex voice.')
  const speechRate = options.speechRate
  if (speechRate !== undefined && (!Number.isInteger(speechRate) || speechRate < -50 || speechRate > 100)) {
    throw new DoubaoFrameError('Doubao speech rate must be an integer from -50 to 100.')
  }
  const dialogId = options.dialogId ?? ''
  if (dialogId.length > 128) throw new DoubaoFrameError('Doubao dialog id is too long.')
  return {
    type: 'session.create',
    ...(options.eventId ? { event_id: options.eventId } : {}),
    session: {
      ...(dialogId ? { id: dialogId } : {}),
      model: DOUBAO_SEEDUPLEX_MODEL,
      instructions: [
        'You are SuperOne\'s voice companion. Speak the user\'s language in short sentences.',
        'Greetings and small talk: answer yourself. Do not call delegate_task.',
        'delegate_task sends the conversation between you and the user to the backend agent. It takes no arguments. Do not write a task. Call it again only after a new request.',
        'The call returns immediately, but the work is asynchronous. A return does not mean the task is finished.',
        'For project work, briefly say, in the user\'s language, that it has started, then call it once. Do not add any other explanation.',
        'After the call, add nothing of your own. The host forwards the backend agent\'s reply to you, and you read it aloud. If the user speaks, answer them.',
      ].join('\n'),
      audio: {
        input: { format: { type: 'pcm', rate: DOUBAO_UPLINK_SAMPLE_RATE } },
        output: {
          format: { type: 'pcm_s16le', rate: DOUBAO_DOWNLINK_SAMPLE_RATE },
          ...(speechRate !== undefined ? { speed: speechRate } : {}),
          voice: speaker,
        },
      },
      tools: [doubaoDelegateTool()],
    },
  }
}

export function inputAudioAppend(pcm: Uint8Array, eventId?: string): Record<string, unknown> {
  return { type: 'input_audio_buffer.append', ...(eventId ? { event_id: eventId } : {}), audio: bytesToBase64(pcm) }
}

export function inputAudioMute(muted: boolean, eventId?: string): Record<string, unknown> {
  return { type: muted ? 'input_audio_mute.commit' : 'input_audio_unmute.commit', ...(eventId ? { event_id: eventId } : {}) }
}

export function responseCancel(eventId?: string): Record<string, unknown> {
  return { type: 'response.cancel', ...(eventId ? { event_id: eventId } : {}) }
}

export function sessionClose(eventId?: string): Record<string, unknown> {
  return { type: 'session.close', ...(eventId ? { event_id: eventId } : {}) }
}

/** Replacement speech: stream the words, then commit. This is the Seeduplex form of ChatTTSText. */
export function speechReplacementMessages(content: string, eventId?: string): Array<Record<string, unknown>> {
  return [
    { type: 'speech_text_buffer.replacement.append', ...(eventId ? { event_id: eventId } : {}), text: content },
    { type: 'speech_text_buffer.replacement.commit', ...(eventId ? { event_id: `${eventId}:end` } : {}) },
  ]
}

/** SayHello equivalent. The live spike uses this only if replacement speech is rejected. */
export function speechTextCommit(text: string, eventId?: string): Record<string, unknown> {
  return { type: 'speech_text_buffer.commit', ...(eventId ? { event_id: eventId } : {}), text }
}

/** Return function results so Seeduplex can match them by call_id. */
export function toolResultEvent(results: Array<{ callId: string; text: string }>, eventId?: string): Record<string, unknown> {
  return {
    type: 'conversation.item.create',
    ...(eventId ? { event_id: eventId } : {}),
    items: results.map(result => ({
      call_id: result.callId,
      role: 'tool',
      content: [{ type: 'input_text', text: result.text }],
    })),
  }
}

/** Seeduplex keeps the last 20 rounds and rejects more than 20 in one create. */
export const DOUBAO_HISTORY_PAIR_CAP = 20

export interface DoubaoHistoryLine {
  role: string
  text: string
  /** Stable id from the saved transcript. Omitted ids get a positional id. */
  id?: string
}

/**
 * A draft session can persist the readout and lose the user's opening line.
 * That line is still in the delegation envelope. Put it back in front so the
 * saved answer is not dropped for lack of a pair.
 */
export function recoverLeadingVoiceUsers(
  lines: readonly DoubaoHistoryLine[],
  delegationTexts: readonly string[],
): DoubaoHistoryLine[] {
  if (lines[0]?.role !== 'assistant') return [...lines]
  const known = new Set(lines.filter(line => line.role === 'user').map(line => line.text.trim()))
  const missing: DoubaoHistoryLine[] = []
  for (const text of delegationTexts) {
    const parsed = parseRealtimeDelegation(text)
    if (!parsed) continue
    for (const line of parsed.transcript) {
      if (line.role !== 'user') continue
      const spoken = line.text.trim()
      if (!spoken || known.has(spoken)) continue
      known.add(spoken)
      missing.push({ role: 'user', text: spoken })
    }
  }
  return missing.length > 0 ? [...missing, ...lines] : [...lines]
}

/**
 * Prior voice turns for a new dialog.
 * Seeduplex wants user/assistant pairs, an even count, and at most 20 rounds.
 * A trailing user line with no answer is left out. Consecutive lines of the
 * same role become one turn. Timestamps are omitted: the clock unit is not
 * specified, and a mixed or future timestamp is rejected. Item order is the order.
 */
export function historyItemsEvent(lines: readonly DoubaoHistoryLine[]): Record<string, unknown> | null {
  const turns = pairedHistoryTurns(lines)
  if (turns.length === 0) return null
  return {
    type: 'conversation.item.create',
    items: turns.map((turn, index) => ({
      id: turn.id ?? `history-${index}`,
      type: 'message',
      role: turn.role,
      content: [{ type: 'input_text', text: turn.text }],
    })),
  }
}

function pairedHistoryTurns(lines: readonly DoubaoHistoryLine[]): Array<{ role: 'user' | 'assistant'; text: string; id?: string }> {
  const cleaned: Array<{ role: 'user' | 'assistant'; text: string; id?: string }> = []
  for (const line of lines) {
    if (line.role !== 'user' && line.role !== 'assistant') continue
    const text = line.text.trim()
    if (!text) continue
    const last = cleaned[cleaned.length - 1]
    if (last && last.role === line.role) {
      last.text = `${last.text}\n${text}`
      continue
    }
    const id = line.id?.trim()
    cleaned.push({ role: line.role, text, ...(id ? { id } : {}) })
  }
  while (cleaned[0]?.role === 'assistant') cleaned.shift()
  if (cleaned.at(-1)?.role === 'user') cleaned.pop()
  const pairs = Math.floor(cleaned.length / 2)
  if (pairs === 0) return []
  const kept = Math.min(pairs, DOUBAO_HISTORY_PAIR_CAP)
  return cleaned.slice(cleaned.length - kept * 2)
}

export interface SpeakableBlock {
  key: string
  /** Full block, including tables, code, and images. This is what the voice transcript shows. */
  display: string
  /** Prose for TTS. Empty when the block is only a table, code, or an image. */
  spoken: string
}

/**
 * Closed text blocks from a delegated reply.
 * `display` keeps the block as written. `spoken` is the prose the host may read.
 * The last block of a message that is still streaming stays open.
 * `settleAll` closes that block too, when the turn itself has ended.
 */
export function closedSpeakableBlocks(
  messages: ReadonlyArray<{
    id: string
    role: string
    status?: string
    content: ReadonlyArray<{ type: string; id?: string; text?: string }>
  }>,
  after: number,
  settleAll: boolean,
): SpeakableBlock[] {
  const blocks: SpeakableBlock[] = []
  for (let index = Math.max(0, after); index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant') continue
    const content = message.content
    const streaming = !settleAll && message.status === 'streaming'
    content.forEach((block, blockIndex) => {
      if (block.type !== 'text' || typeof block.text !== 'string') return
      if (streaming && blockIndex === content.length - 1) return
      const display = block.text.trim()
      if (!display) return
      blocks.push({
        key: `${message.id}:${block.id ?? blockIndex}`,
        display,
        spoken: speakableAgentReply(block.text),
      })
    })
  }
  return blocks
}

export interface DelegationIdleOutcome {
  /** Assistant messages that finished in this idle and had not been counted. */
  settledIds: string[]
  /** Delegations still waiting for their own assistant to finish. */
  pending: number
  /** The last parked delegation has finished. The host may speak the fallback. */
  finishWatch: boolean
}

/**
 * Idle ends the voice report only when a delegated assistant has finished.
 * The turn that was already running has no assistant at or after `replyAfter`,
 * so that idle must not say the fallback or stop watching.
 * One idle consumes one parked delegation, even if that turn opened several
 * assistant messages. Further parked tasks stay open.
 */
export function delegationIdleOutcome(
  messages: ReadonlyArray<{ id: string; role: string; status?: string }>,
  replyAfter: number,
  pending: number,
  settled: ReadonlySet<string>,
): DelegationIdleOutcome {
  const settledIds: string[] = []
  for (let index = Math.max(0, replyAfter); index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant' || message.status === 'streaming') continue
    if (settled.has(message.id)) continue
    settledIds.push(message.id)
  }
  if (settledIds.length === 0 || pending <= 0) return { settledIds, pending, finishWatch: false }
  const next = pending - 1
  return { settledIds, pending: next, finishWatch: next === 0 }
}

/** Prose a voice can say. Tables, fenced code, and images stay on screen only. */
export function speakableAgentReply(text: string): string {
  const unwrapped = text.replace(SPOKEN_TAG, ' $1 ')
  const withoutCode = unwrapped.replace(/```[\s\S]*?```/g, '\n')
  const withoutTables = withoutCode
    .replace(/<table\b[\s\S]*?<\/table>/gi, '\n')
    .split('\n')
    .filter(line => !isMarkdownTableLine(line))
    .join('\n')
  const prose = withoutTables
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!prose) return ''
  if (prose.length <= DOUBAO_SPEAKABLE_CHARS) return prose
  return prose.slice(0, DOUBAO_SPEAKABLE_CHARS).trimEnd()
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const pipes = trimmed.split('|').length - 1
  if (pipes < 2) return false
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed) || /\|/.test(trimmed)
}

export function encodeSeeduplexEvent(event: Record<string, unknown>): string {
  if (typeof event.type !== 'string' || event.type.length === 0) throw new DoubaoFrameError('Seeduplex event type is required.')
  return JSON.stringify(event)
}

export function parseSeeduplexEvent(text: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new DoubaoFrameError('Seeduplex event was not JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DoubaoFrameError('Seeduplex event was not an object.')
  const record = parsed as Record<string, unknown>
  if (typeof record.type !== 'string' || record.type.length === 0) throw new DoubaoFrameError('Seeduplex event type is required.')
  return record
}

/**
 * Pull the spoken summary out of an agent reply.
 * A summary longer than the speech cap stays in the visible text as well.
 */
export function extractSpokenSummary(text: string): { display: string; spoken: string | null } {
  const parts: string[] = []
  const stripped = text.replace(SPOKEN_TAG, (_match, inner: string) => {
    const trimmed = inner.trim()
    if (trimmed) parts.push(trimmed)
    return ''
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const spoken = parts.join(' ').trim()
  if (!spoken) return { display: stripped, spoken: null }
  if (spoken.length <= MAX_SPOKEN_CHARS) return { display: stripped, spoken }
  return { display: [stripped, spoken].filter(Boolean).join('\n\n'), spoken: spoken.slice(0, MAX_SPOKEN_CHARS) }
}

/**
 * Assistant text for the bubble. Closed spoken tags are removed. An unclosed
 * tag at the end is hidden until it closes, so the marker does not flash.
 */
export function visibleAssistantText(text: string): string {
  if (!text.includes('<spoken')) return text
  const { display } = extractSpokenSummary(text)
  return display.replace(/\s*<spoken\b[^>]*>[\s\S]*$/i, '').trimEnd()
}

/** Split a PCM buffer into 20 ms uplink frames. The remainder waits for the next chunk. */
export function slicePcm20ms(pcm: Uint8Array): { frames: Uint8Array[]; remainder: Uint8Array } {
  const frames: Uint8Array[] = []
  let offset = 0
  while (offset + DOUBAO_UPLINK_FRAME_BYTES <= pcm.length) {
    frames.push(pcm.slice(offset, offset + DOUBAO_UPLINK_FRAME_BYTES))
    offset += DOUBAO_UPLINK_FRAME_BYTES
  }
  return { frames, remainder: pcm.slice(offset) }
}

export function redactDoubaoText(value: string): string {
  return redactVoiceText(value)
    .replace(/X-Api-Key\s*[:=]\s*\S+/gi, 'X-Api-Key: [REDACTED]')
    .replace(/X-Api-Access-Key\s*[:=]\s*\S+/gi, 'X-Api-Access-Key: [REDACTED]')
}

export interface DoubaoHandshakeFailure {
  status: number
  code?: string
  message: string
  logid?: string
}

/** Read the JSON body a rejected WebSocket upgrade returns before status 101. */
export function readDoubaoHandshakeFailure(status: number, body: string, logid?: string | null): DoubaoHandshakeFailure {
  let code: string | undefined
  let message = body.trim()
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: { code?: unknown; message?: unknown } }
    const nestedCode = parsed.error?.code
    const nestedMessage = parsed.error?.message ?? parsed.message
    if (typeof nestedCode === 'string' || typeof nestedCode === 'number') code = String(nestedCode)
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) message = nestedMessage.trim()
  } catch {
    // A proxy or TLS error can return a non-JSON body.
  }
  return {
    status,
    ...(code ? { code } : {}),
    message: redactDoubaoText(message).slice(0, 300),
    ...(logid ? { logid } : {}),
  }
}

export function isDoubaoRetryableStatus(code: string | number | undefined): boolean {
  const numeric = typeof code === 'number' ? code : Number(code)
  if (!Number.isFinite(numeric)) return false
  return (numeric >= 500 && numeric <= 599) || (numeric >= 50_000_000 && numeric <= 59_999_999)
}

export function interpretDoubaoServerEvent(event: Record<string, unknown>): DoubaoServerNotice {
  const type = typeof event.type === 'string' ? event.type : ''
  switch (type) {
    case 'session.created':
      return { type: 'session-started', dialogId: sessionId(event) }
    case 'session.updated':
      return { type: 'session-updated' }
    case 'session.closed':
      return { type: 'session-finished' }
    case 'response.done':
      return { type: 'usage' }
    case 'conversation.item.input_audio_transcription.started':
      return { type: 'asr-info' }
    case 'conversation.item.input_audio_transcription.delta':
      return { type: 'asr', text: readAsrHypothesis(event), interim: true }
    case 'conversation.item.input_audio_transcription.completed':
      return { type: 'asr-ended', text: readAsrHypothesis(event) }
    case 'conversation.item.input_audio_transcription.failed':
      return { type: 'asr-failed', message: redactDoubaoText(readString(event.message) ?? 'Doubao transcription failed.') }
    case 'response.output_text.delta':
      return { type: 'chat', content: readTranscript(event) }
    case 'response.output_text.done':
      return { type: 'chat-ended' }
    case 'response.output_audio.started': {
      const ttsType = readString(nested(event, 'tts_type'))
      return { type: 'tts-start', text: readTranscript(event), ...(ttsType ? { ttsType } : {}) }
    }
    case 'response.output_audio.delta': {
      const pcm = readAudio(event)
      return pcm ? { type: 'tts-audio', pcm } : { type: 'ignored', event: type }
    }
    case 'response.output_audio.done': {
      const statusCode = readStatus(event.status_code)
      return { type: 'tts-ended', ...(statusCode ? { statusCode } : {}), exitIntent: statusCode === '20000002' }
    }
    case 'response.canceled':
      return { type: 'response-canceled' }
    case 'response.function_call_arguments.done': {
      const calls = readFunctionCalls(event)
      return calls.length > 0 ? { type: 'function-calls', calls } : { type: 'ignored', event: type }
    }
    case 'error': {
      const code = readStatus(event.code) ?? readStatus(nested(event, 'code'))
      const message = redactDoubaoText(readString(event.message) ?? readString(nested(event, 'message')) ?? 'Doubao request failed.')
      return { type: 'error', ...(code ? { code } : {}), message, retryable: isDoubaoRetryableStatus(code) }
    }
    default:
      return { type: 'ignored', ...(type ? { event: type } : {}) }
  }
}

function sessionId(event: Record<string, unknown>): string {
  const session = event.session
  if (!session || typeof session !== 'object' || Array.isArray(session)) return ''
  return readString((session as Record<string, unknown>).id) ?? ''
}

function readFunctionCalls(event: Record<string, unknown>): DoubaoFunctionCall[] {
  const buckets: unknown[] = []
  if (Array.isArray(event.items)) buckets.push(...event.items)
  else if (event.item && typeof event.item === 'object') buckets.push(event.item)
  else buckets.push(event)
  const calls: DoubaoFunctionCall[] = []
  for (const item of buckets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const callId = readString(record.call_id)
    const name = readString(record.name)
    if (!callId || !name) continue
    calls.push({ callId, name, arguments: readString(record.arguments) ?? '' })
  }
  return calls
}

function readAsrHypothesis(event: Record<string, unknown>): string {
  const results = event.results
  if (Array.isArray(results)) {
    for (let index = results.length - 1; index >= 0; index -= 1) {
      const item = results[index]
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const text = readString((item as Record<string, unknown>).text)
      if (text) return text
    }
  }
  return readTranscript(event)
}

function readTranscript(event: Record<string, unknown>): string {
  return readString(event.delta) ?? readString(event.text) ?? readString(event.transcript) ?? ''
}

/**
 * ASR hypotheses are often the full line so far, not a suffix.
 * A longer line that already starts with what we showed contributes only the new tail.
 * A revision replaces the line, including one that only rewrites the ending
 * ("hello" → "哈喽"). A long incoming line is another full hypothesis.
 * A short non-overlapping fragment is appended.
 */
export function mergeAsrText(current: string, incoming: string): { text: string; delta: string; replace: boolean } | null {
  if (!incoming) return null
  if (!current) return { text: incoming, delta: incoming, replace: false }
  if (incoming === current) return null
  if (incoming.startsWith(current)) {
    const delta = incoming.slice(current.length)
    return delta ? { text: incoming, delta, replace: false } : null
  }
  if (current.startsWith(incoming)) return null
  const prefix = sharedPrefixLength(current, incoming)
  const revision = prefix >= 4 || (current.length >= 2 && prefix >= current.length * 0.5)
  if (revision || incoming.length > 8) {
    return { text: incoming, delta: incoming, replace: true }
  }
  return { text: current + incoming, delta: incoming, replace: false }
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function readAudio(event: Record<string, unknown>): Uint8Array | null {
  const encoded = readString(event.delta) ?? readString(event.audio)
  if (!encoded) return null
  try {
    return base64ToBytes(encoded)
  } catch {
    return null
  }
}

function nested(event: Record<string, unknown>, key: string): unknown {
  const error = event.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return event[key]
  return (error as Record<string, unknown>)[key] ?? event[key]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readStatus(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new DoubaoFrameError('Doubao audio was not base64.')
  const bytes = Buffer.from(normalized, 'base64')
  if (bytes.length === 0) throw new DoubaoFrameError('Doubao audio was not base64.')
  return new Uint8Array(bytes)
}
