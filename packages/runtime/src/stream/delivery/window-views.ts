import type { ChatMessage } from '@superone/shared/agent-types'
import type {
  TranscriptWindowBudget,
  TranscriptWindowFragment,
  TranscriptWindowMessage,
  TranscriptWindowPatch,
  TranscriptWindowRequest,
} from '@superone/shared/environment/transcript-window'
import { utf8Length } from '@superone/shared/transcript-window/content-digest'
import { fragmentDigest, MessageFragmenter, textBody, type MessageFragments } from '@superone/shared/transcript-window/fragment-message'
import { selectTranscriptWindow, type SelectedWindow, type WindowSource } from '@superone/shared/transcript-window/select-window'
import { projectWindowMessage } from './window-projection'
import { arrayTranscript, type TranscriptAccess } from './transcript-access'

/**
 * What one message may add to a live patch: a new message enters with its
 * newest fragments, and a held message whose changes exceed this (a rewritten
 * reply) re-enters the same way instead of resending what the client held.
 */
export const LIVE_MESSAGE_BUDGET: TranscriptWindowBudget = { maxBytes: 64 * 1024, maxFragments: 24, targetChars: Number.MAX_SAFE_INTEGER }
/** What one patch may carry, serialized; older changed messages past it leave the window. */
export const LIVE_PATCH_BYTES = 256 * 1024
/** Held windows per connection; the least recently served or patched goes first. */
export const MAX_HELD = 64

interface HeldFragment { digest: string; textLength?: number }

interface HeldMessage {
  metaDigest: string
  fragments: Map<string, HeldFragment>
  /** Content-order keys the holder has, contiguous. */
  keys: string[]
  omittedBefore: number
  omittedAfter: number
}

export interface EvictedWindowHolder {
  sessionId: string
  holder: string
}

interface HeldWindow {
  messages: Map<string, HeldMessage>
  order: string[]
  /** The window reaches the live tail, so new messages join it. */
  atTail: boolean
  total: number
  /** Source object per held message, to find what changed. */
  seen: Map<string, ChatMessage>
}

/** One session's fragmenting, shared by its holders on a connection. */
class SessionFragments {
  private readonly fragmenter = new MessageFragmenter()
  private readonly cache = new WeakMap<ChatMessage, MessageFragments>()

  of(message: ChatMessage): MessageFragments {
    let fragments = this.cache.get(message)
    if (!fragments) {
      fragments = this.fragmenter.fragment(projectWindowMessage(message))
      this.cache.set(message, fragments)
    }
    return fragments
  }

  source(transcript: TranscriptAccess): WindowSource {
    return {
      count: transcript.count,
      at: (index) => this.of(transcript.messageAt(index)),
      indexOf: (messageId) => transcript.indexOf(messageId),
    }
  }

  retain(messages: Iterable<string>): void {
    this.fragmenter.retain(messages)
  }
}

/**
 * The transcript windows one connection holds, per session and holder (a
 * routing desktop relays for several phones), and the live patches that keep
 * them current. A holder's window mirrors what its client joined: a tail or
 * anchored window replaces it, `before` / `after` pages extend it.
 */
export class WindowViews {
  private readonly sessions = new Map<string, { fragments: SessionFragments; holders: Map<string, HeldWindow> }>()
  /** Holders the 64-window cap dropped since the last drain. Switching a holder off a session is not an eviction. */
  private readonly evicted: EvictedWindowHolder[] = []

  has(sessionId: string): boolean {
    return (this.sessions.get(sessionId)?.holders.size ?? 0) > 0
  }

  /** Holder ids following `sessionId`, oldest serve first. */
  holderIds(sessionId: string): string[] {
    return [...this.sessions.get(sessionId)?.holders.keys() ?? []]
  }

  /** Holders dropped by the cap. Each call takes them, so a frame reports an eviction once. */
  drainEvicted(): EvictedWindowHolder[] {
    return this.evicted.splice(0)
  }

  serve(input: {
    sessionId: string
    holder: string
    /** Dense transcript. Indexes are absolute because the array is the whole session. */
    messages?: readonly ChatMessage[]
    /** Absolute-index transcript. `count` is the real length even when only a tail was parsed. */
    transcript?: TranscriptAccess
    request: Pick<TranscriptWindowRequest, 'anchor' | 'direction' | 'have'>
    budget: TranscriptWindowBudget
  }): SelectedWindow & { total: number } {
    const transcript = input.transcript ?? (input.messages ? arrayTranscript(input.messages) : null)
    if (!transcript) throw new Error('transcript window needs messages')
    const session = this.session(input.sessionId)
    const selected = selectTranscriptWindow(session.fragments.source(transcript), input.request, input.budget)
    const extend = input.request.anchor && input.request.direction !== 'around' ? input.request.direction ?? 'before' : null
    const previous = session.holders.get(input.holder)
    const held = extend && previous ? previous : { messages: new Map(), order: [], atTail: false, total: 0, seen: new Map() }
    for (const message of selected.messages) {
      const source = transcript.messageAt(message.index)
      const fragments = session.fragments.of(source)
      // A joined message keeps the source the client last caught up with, so the next diff still sends what changed since.
      if (!held.messages.has(message.id)) held.seen.set(message.id, source)
      recordMessage(held, message, fragments, extend === 'before' ? 'before' : extend === 'after' ? 'after' : null)
    }
    const ids = selected.messages.map((message) => message.id)
    held.order = extend === 'before' ? [...ids, ...held.order.filter((id) => !ids.includes(id))]
      : extend === 'after' ? [...held.order.filter((id) => !ids.includes(id)), ...ids] : ids
    if (!extend || extend === 'after') held.atTail = selected.newer === null
    held.total = transcript.count
    session.holders.delete(input.holder)
    session.holders.set(input.holder, held)
    // A client follows one session: its window elsewhere is gone.
    for (const [id, other] of this.sessions) {
      if (id === input.sessionId) continue
      other.holders.delete(input.holder)
      if (!other.holders.size) this.sessions.delete(id)
    }
    this.touch(input.sessionId)
    this.evict()
    session.fragments.retain(this.heldIds(input.sessionId))
    return { ...selected, total: transcript.count }
  }

  /** Patches for every holder of a session whose window `messages` changed. */
  patches(sessionId: string, messages: readonly ChatMessage[]): Array<{ holder: string; patch: TranscriptWindowPatch }> {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    const out: Array<{ holder: string; patch: TranscriptWindowPatch }> = []
    for (const [holder, held] of session.holders) {
      const patch = diffHeld(held, messages, session.fragments)
      if (patch) out.push({ holder, patch })
    }
    if (out.length) {
      session.fragments.retain(this.heldIds(sessionId))
      this.touch(sessionId)
    }
    return out
  }

  close(sessionId: string, holder?: string): void {
    if (holder === undefined) { this.sessions.delete(sessionId); return }
    const session = this.sessions.get(sessionId)
    session?.holders.delete(holder)
    if (session && !session.holders.size) this.sessions.delete(sessionId)
  }

  clear(): void {
    this.sessions.clear()
  }

  private session(sessionId: string) {
    let session = this.sessions.get(sessionId)
    if (!session) this.sessions.set(sessionId, session = { fragments: new SessionFragments(), holders: new Map() })
    return session
  }

  /** Most recently used sessions last, so eviction takes the stalest first. */
  private touch(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, session)
  }

  private heldIds(sessionId: string): Set<string> {
    const ids = new Set<string>()
    for (const held of this.sessions.get(sessionId)?.holders.values() ?? []) for (const id of held.order) ids.add(id)
    return ids
  }

  private evict(): void {
    let count = 0
    for (const session of this.sessions.values()) count += session.holders.size
    for (const [sessionId, session] of this.sessions) {
      if (count <= MAX_HELD) return
      for (const holder of session.holders.keys()) {
        if (count <= MAX_HELD) break
        session.holders.delete(holder)
        this.evicted.push({ sessionId, holder })
        count--
      }
      if (!session.holders.size) this.sessions.delete(sessionId)
    }
  }
}

function recordMessage(held: HeldWindow, message: TranscriptWindowMessage, fragments: MessageFragments, join: 'before' | 'after' | null): void {
  const previous = held.messages.get(message.id)
  const sent = message.fragments.map((fragment) => fragment.key)
  const entries = new Map(fragments.fragments.map((fragment) => [fragment.key, fragment]))
  const record = (keys: string[]) => new Map(keys.flatMap((key): Array<[string, HeldFragment]> => {
    const entry = entries.get(key)
    return entry ? [[key, heldFragment(entry.digest, entry.body)]] : []
  }))
  // A join adds the page's new keys; keys the client already held keep the digest and meta it holds.
  const joined = (keys: string[]) => new Map([...record(keys.filter((key) => !previous!.fragments.has(key))), ...previous!.fragments])
  if (previous && join === 'before') {
    const keys = [...sent, ...previous.keys.filter((key) => !sent.includes(key))]
    held.messages.set(message.id, { ...previous, keys, fragments: joined(keys), omittedBefore: message.omittedBefore })
    return
  }
  if (previous && join === 'after') {
    const keys = [...previous.keys.filter((key) => !sent.includes(key)), ...sent]
    held.messages.set(message.id, { ...previous, keys, fragments: joined(keys), omittedAfter: message.omittedAfter })
    return
  }
  held.messages.set(message.id, {
    metaDigest: message.metaDigest, keys: sent, fragments: record(sent),
    omittedBefore: message.omittedBefore, omittedAfter: message.omittedAfter,
  })
}

function heldFragment(digest: string, body: MessageFragments['fragments'][number]['body']): HeldFragment {
  return body.kind === 'text' ? { digest, textLength: body.text.length } : { digest }
}

/**
 * The patch that brings a holder's window to `messages`, recording it as held.
 * Held messages that changed list every held fragment (bodies only where the
 * digest moved; a grown text slice sends its new tail). New messages at a tail
 * window enter with their newest fragments under the live budget.
 */
function diffHeld(held: HeldWindow, messages: readonly ChatMessage[], fragments: SessionFragments): TranscriptWindowPatch | null {
  const index = new Map(messages.map((message, i) => [message.id, i]))
  const present = held.order.filter((id) => index.has(id))
  const removed = held.order.filter((id) => !index.has(id))
  let range: number[]
  if (held.atTail) {
    // An empty window takes every message that arrived since it was last brought up to date.
    const start = present.length ? Math.min(...present.map((id) => index.get(id)!)) : Math.min(held.total, messages.length)
    range = messages.length ? Array.from({ length: messages.length - start }, (_, i) => start + i) : []
  } else {
    range = present.map((id) => index.get(id)!).sort((a, b) => a - b)
  }
  const changed: TranscriptWindowMessage[] = []
  // Newest first: once the patch is full, the window starts after the last message that fit,
  // and the client pages back for the rest.
  let remaining = LIVE_PATCH_BYTES - utf8Length(JSON.stringify({ messages: [], removed, order: range.map((i) => messages[i].id), total: messages.length }))
  let start = 0
  for (let r = range.length - 1; r >= 0; r--) {
    const source = messages[range[r]]
    if (held.seen.get(source.id) === source && held.messages.has(source.id)) continue
    const { message, record } = diffMessage(held.messages.get(source.id), fragments.of(source), range[r], Math.max(0, Math.min(LIVE_MESSAGE_BUDGET.maxBytes, remaining)))
    const bytes = message ? patchBytes(message) : 0
    if (bytes > remaining && changed.length) { start = r + 1; break }
    remaining -= bytes
    held.messages.set(source.id, record)
    held.seen.set(source.id, source)
    if (message) changed.unshift(message)
  }
  for (const i of range.slice(0, start)) { held.messages.delete(messages[i].id); held.seen.delete(messages[i].id) }
  const order = range.slice(start).map((i) => messages[i].id)
  for (const id of removed) { held.messages.delete(id); held.seen.delete(id) }
  const reordered = order.length !== held.order.length || order.some((id, i) => id !== held.order[i])
  const totalChanged = held.total !== messages.length
  if (!changed.length && !removed.length && !reordered && !totalChanged) return null
  held.order = order
  held.total = messages.length
  return {
    messages: changed,
    ...(removed.length ? { removed } : {}),
    ...(reordered ? { order } : {}),
    total: messages.length,
  }
}

function diffMessage(previous: HeldMessage | undefined, current: MessageFragments, index: number, maxBytes: number): { message: TranscriptWindowMessage | null; record: HeldMessage } {
  const all = current.fragments
  let start: number
  let end = all.length
  if (!previous) {
    start = tailStart(current, maxBytes)
  } else {
    const first = previous.omittedBefore > 0 ? all.findIndex((fragment) => fragment.key === previous.keys[0]) : 0
    start = first < 0 ? tailStart(current, maxBytes) : first
    if (previous.omittedAfter > 0) {
      const last = all.findIndex((fragment) => fragment.key === previous.keys[previous.keys.length - 1])
      if (last >= start) end = last + 1
    }
  }
  let sent = diffFragments(previous, all.slice(start, end))
  // A rewrite larger than the budget re-enters as the newest fragments rather than resending the whole held range.
  if (sent.reduce((bytes, fragment) => bytes + fragmentPatchBytes(fragment), 0) > maxBytes) {
    start = Math.max(start, tailStart(current, maxBytes))
    end = all.length
    sent = diffFragments(previous, all.slice(start, end))
  }
  const omittedBefore = all.length ? start : 0
  const omittedAfter = all.length ? all.length - end : 0
  const metaHeld = previous?.metaDigest === current.metaDigest
  const unchanged = previous && metaHeld && previous.omittedBefore === omittedBefore
    && previous.omittedAfter === omittedAfter && previous.keys.length === sent.length
    && sent.every((fragment, i) => !fragment.body && fragment.append === undefined && previous.keys[i] === fragment.key)
  const record: HeldMessage = {
    metaDigest: current.metaDigest,
    keys: sent.map((fragment) => fragment.key),
    fragments: new Map(all.slice(start, end).map((fragment) => [fragment.key, heldFragment(fragment.digest, fragment.body)])),
    omittedBefore,
    omittedAfter,
  }
  if (unchanged) return { message: null, record }
  return {
    record,
    message: {
      id: current.id,
      index,
      metaDigest: current.metaDigest,
      ...(metaHeld ? {} : { meta: current.meta }),
      fragments: sent,
      omittedBefore,
      omittedAfter,
    },
  }
}

/** Each fragment as a reference, an appended tail, or a new body, against what the client holds. */
function diffFragments(previous: HeldMessage | undefined, fragments: MessageFragments['fragments']): TranscriptWindowFragment[] {
  return fragments.map((fragment) => {
    const heldFragment = previous?.fragments.get(fragment.key)
    if (heldFragment?.digest === fragment.digest) return { key: fragment.key, digest: fragment.digest }
    const body = fragment.body
    if (heldFragment?.textLength !== undefined && body.kind === 'text' && body.text.length > heldFragment.textLength
      && fragmentDigest(textBody(body.head, body.offset, body.text.slice(0, heldFragment.textLength), body.context)) === heldFragment.digest) {
      return { key: fragment.key, digest: fragment.digest, append: body.text.slice(heldFragment.textLength) }
    }
    return { key: fragment.key, digest: fragment.digest, body }
  })
}

function fragmentPatchBytes(fragment: TranscriptWindowFragment): number {
  return fragment.body ? utf8Length(JSON.stringify(fragment.body)) : fragment.append !== undefined ? utf8Length(fragment.append) : 0
}

/** Serialized size of `message` in a patch, with its separator. */
function patchBytes(message: TranscriptWindowMessage): number {
  return utf8Length(JSON.stringify(message)) + 1
}

/** First fragment a message enters with: as many newest ones as `maxBytes` allows, and at least one. */
function tailStart(current: MessageFragments, maxBytes: number): number {
  let bytes = current.metaBytes
  let start = current.fragments.length
  while (start > 0) {
    const next = current.fragments[start - 1]
    if (current.fragments.length - start >= LIVE_MESSAGE_BUDGET.maxFragments || bytes + next.bytes > maxBytes) break
    bytes += next.bytes
    start--
  }
  return start === current.fragments.length && start > 0 ? start - 1 : start
}
