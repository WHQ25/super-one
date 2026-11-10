import { formatRealtimeDelegation, type RealtimeTranscriptLine } from './realtime-timeline'

/**
 * Voice session pieces shared by realtime frontends.
 * PCM is 16 kHz mono s16le uplink and 24 kHz downlink. A frame is 20 ms.
 */

export const VOICE_UPLINK_SAMPLE_RATE = 16_000
export const VOICE_UPLINK_FRAME_BYTES = 640
/** One uplink frame is 20 ms. Frames go out while the user is speaking, at this rate. */
export const VOICE_UPLINK_FRAME_MS = 20
/** Bound how long a stalled pacer can keep the server from hearing the latest audio. */
export const VOICE_UPLINK_MAX_QUEUED_FRAMES = 25
export const VOICE_DOWNLINK_SAMPLE_RATE = 24_000
export const VOICE_FALLBACK_SPOKEN = '做完了'
export const VOICE_DELEGATE_TOOL = 'delegate_task'
/** Spoken agent replies stop here so a long write-up does not become a monologue. */
export const VOICE_SPEAKABLE_CHARS = 1200

export const VOICE_COMMON_INSTRUCTIONS = [
  'You are SuperOne\'s voice companion. Speak the user\'s language in short sentences.',
  'Greetings and small talk: answer yourself. Do not call delegate_task.',
  'You cannot see files, run commands, browse, or change the machine yourself. Never refuse. Never tell the user you cannot do something. Call delegate_task so the backend agent does it.',
  'delegate_task sends the conversation between you and the user to the backend agent. It takes no arguments. Do not write a task. Call it again only after a new request.',
] as const

export function buildVoiceInstructions(modelInstructions: readonly string[]): string {
  return [...VOICE_COMMON_INSTRUCTIONS, ...modelInstructions].join('\n')
}

/** First message of a call, including a resumed call. The transcript is what the user just said. */
export const VOICE_OPENING_PREAMBLE = [
  'The user just started a voice session.',
  'This is their first message. The transcript is what they said, in their words. Do that.',
  'Reply in a colloquial, concise way, in the user\'s language.',
  'Tables and code may stay in the reply. The voice transcript shows them, and only the prose is read aloud.',
  'Do not mention the voice layer.',
  'If they only greeted you and asked for nothing, do not reply.',
].join(' ')

export const VOICE_DELEGATION_PREAMBLE = [
  'This request is from the open voice session.',
  'The transcript is what the user just said, in their words. Do that.',
  'Reply in a colloquial, concise way, in the user\'s language.',
  'Tables and code may stay in the reply. The voice transcript shows that reply. Only the prose is read aloud.',
  'Do not mention the voice layer.',
].join(' ')

export type VoiceDelegationKind = 'opening' | 'turn'

/**
 * The backing-thread turn for one spoken delegation.
 * Opening and later turns send the spoken lines once, in `<transcript_delta>`.
 * The user's words are already in that script, so they are not copied into `<input>`.
 * The preamble sits outside both tags. Hangup does not send another turn.
 */
export function voiceDelegationContent(
  utterance: string,
  transcript: readonly RealtimeTranscriptLine[] = [],
  kind: VoiceDelegationKind = 'turn',
): string {
  return formatRealtimeDelegation({
    preamble: kind === 'opening' ? VOICE_OPENING_PREAMBLE : VOICE_DELEGATION_PREAMBLE,
    instruction: '',
    transcript,
  })
}

const MAX_SPOKEN_CHARS = 600
const SPOKEN_TAG = /<spoken>([\s\S]*?)<\/spoken>/gi
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
  if (prose.length <= VOICE_SPEAKABLE_CHARS) return prose
  return prose.slice(0, VOICE_SPEAKABLE_CHARS).trimEnd()
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const pipes = trimmed.split('|').length - 1
  if (pipes < 2) return false
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed) || /\|/.test(trimmed)
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
  while (offset + VOICE_UPLINK_FRAME_BYTES <= pcm.length) {
    frames.push(pcm.slice(offset, offset + VOICE_UPLINK_FRAME_BYTES))
    offset += VOICE_UPLINK_FRAME_BYTES
  }
  return { frames, remainder: pcm.slice(offset) }
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
