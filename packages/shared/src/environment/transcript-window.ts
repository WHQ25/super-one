import type { ChatMessage, ContentBlock, ImageAttachment } from '../agent-types'
import type { SessionLoadCursor, SessionRestoreFacts } from './session-messages'

/**
 * `session.transcriptWindow`: a bounded window of a session transcript cut into
 * addressable fragments, for clients (the phone) that cannot afford whole
 * messages. A fragment is one atomic content block, or one prefix-stable slice
 * of a text block, so a growing reply keeps its earlier fragment keys. Its
 * `digest` hashes the projected body: a client that already holds the digest
 * gets the key without the body, whatever happened to the host's change history.
 */

/** Bumped when fragment cutting, keys or bodies change shape; cached windows of another schema are misses. */
export const TRANSCRIPT_WINDOW_SCHEMA = 1

export interface TranscriptWindowBudget {
  /** Hard ceiling on the serialized result, state and facts excluded. */
  maxBytes: number
  maxFragments: number
  /** Visible characters wanted; met by held and sent fragments alike. */
  targetChars: number
}

/** A fragment, or the start of a message when `key` is absent. */
export interface TranscriptWindowAnchor {
  messageId: string
  key?: string
}

/** Fragments a client holds for one message, so the host can omit their bodies. */
export interface TranscriptWindowCoverage {
  id: string
  /** Digest of the held message meta. */
  meta?: string
  /** `[key, digest]` per held fragment. */
  f: Array<[string, string]>
}

export interface TranscriptWindowRequest {
  sessionId: string
  projectId?: string
  /** Absent: the newest content (the live tail). */
  anchor?: TranscriptWindowAnchor
  /** Relative to `anchor`; `around` starts at the anchor's message. Default `before`. */
  direction?: 'before' | 'after' | 'around'
  /** CSS pixels, to estimate how much text fills a screen. */
  viewport?: { width: number; height: number }
  budget?: Partial<TranscriptWindowBudget>
  have?: TranscriptWindowCoverage[]
  /** Restore state and facts; defaults to true for a tail window only. */
  includeState?: boolean
}

/** Rendering context a slice needs to start mid-block. */
export interface TextFragmentContext {
  /** Opening fence line of a code block the slice starts inside. */
  fence?: string
  /** Header and delimiter rows of a table the slice starts inside. */
  table?: string
  /** Header line of an insight the slice starts inside. */
  insight?: string
}

export type TextLikeBlock = Extract<ContentBlock, { type: 'text' | 'plan' }>
/** A text-like block's attributes without its text. */
export type TextFragmentHead = TextLikeBlock extends infer B ? B extends TextLikeBlock ? Omit<B, 'text'> : never : never

export type TranscriptFragmentBody =
  | { kind: 'text'; head: TextFragmentHead; offset: number; text: string; context?: TextFragmentContext }
  | { kind: 'block'; block: ContentBlock }
  /** One of a user message's attachments, which carry their preview bytes. */
  | { kind: 'attachment'; attachment: ImageAttachment }
  /** An atomic block whose projection alone exceeds a fragment. */
  | { kind: 'omitted'; blockType: string; bytes: number }

export interface TranscriptWindowFragment {
  key: string
  digest: string
  /** Absent when the client holds this digest (coverage, or a live patch's unchanged fragment). */
  body?: TranscriptFragmentBody
  /** Live patches only: text appended to the held body of this key; the result hashes to `digest`. */
  append?: string
}

/** A message without content or attachments, heavy duplicates removed. */
export type TranscriptWindowMeta = Omit<ChatMessage, 'content' | 'attachments'>

export interface TranscriptWindowMessage {
  id: string
  /** Absolute position in the transcript. */
  index: number
  metaDigest: string
  /** Absent when the client holds `metaDigest`. */
  meta?: TranscriptWindowMeta
  /** Contiguous, in content order. */
  fragments: TranscriptWindowFragment[]
  /** Fragments of this message before / after the listed ones. */
  omittedBefore: number
  omittedAfter: number
}

export interface TranscriptWindowResult {
  sessionId: string
  schema: number
  /** Contiguous messages in transcript order. */
  messages: TranscriptWindowMessage[]
  /** Where an older window starts from; null at the start of the transcript. */
  older: TranscriptWindowAnchor | null
  /** Where a newer window starts from; null when the window reaches the live tail. */
  newer: TranscriptWindowAnchor | null
  total: number
  state?: Record<string, unknown>
  restore?: SessionRestoreFacts
  cursor: SessionLoadCursor
  summarized?: true
}

/**
 * Live changes to the window a connection holds, carried by the
 * `transcript_window` agent event in place of the content events it summarizes.
 * Applying one twice is harmless: fragments are digest-checked.
 */
export interface TranscriptWindowPatch {
  /** Changed or new messages; each lists every held fragment, bodies only where changed. */
  messages: TranscriptWindowMessage[]
  removed?: string[]
  /** Held message ids in order, when membership or order changed. */
  order?: string[]
  total: number
}

export const TRANSCRIPT_WINDOW_METHOD = 'session.transcriptWindow'

/** One holder per remote session a controlling desktop shows. `serve` drops a holder's other sessions, so holders are not shared across sessions. */
export const DESKTOP_WINDOW_HOLDER_PREFIX = 'desktop:'

export function desktopWindowHolder(sessionId: string): string {
  const holder = `${DESKTOP_WINDOW_HOLDER_PREFIX}${sessionId}`
  return holder.length <= 128 ? holder : holder.slice(0, 128)
}

/** True when this connection's desktop is showing the session, so its own view still needs content events. */
export function desktopShowsSession(holders: readonly string[]): boolean {
  return holders.some((holder) => holder.startsWith(DESKTOP_WINDOW_HOLDER_PREFIX))
}

/**
 * A host that does not serve a method: hosts that know of it but lack the
 * port mark the error `unsupported`; hosts older than it answer `unknown method`.
 */
export function isUnservedMethod(error: unknown): boolean {
  const { code, message, details } = (error ?? {}) as { code?: string; message?: string; details?: { unsupported?: unknown } }
  return code === 'not_found' && (details?.unsupported === true || (typeof message === 'string' && message.startsWith('unknown method:')))
}

/**
 * A `transcript_window` event envelope. It takes the session version of the
 * frame's last event for its session, so readers that skip a version they
 * already saw must still take it.
 */
export function isTranscriptWindowEnvelope(envelope: { payload: unknown }): boolean {
  return (envelope.payload as { event?: { type?: unknown } } | null)?.event?.type === 'transcript_window'
}
