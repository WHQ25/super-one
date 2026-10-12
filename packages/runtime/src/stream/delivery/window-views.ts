import type { ChatMessage } from '@superone/shared/agent-types'
import type {
  TranscriptWindowBudget,
  TranscriptWindowFragment,
  TranscriptWindowMessage,
  TranscriptWindowPatch,
  TranscriptWindowRequest,
} from '@superone/shared/environment/transcript-window'
import { fragmentDigest, MessageFragmenter, textBody, type MessageFragments } from '@superone/shared/transcript-window/fragment-message'
import { selectTranscriptWindow, type SelectedWindow, type WindowSource } from '@superone/shared/transcript-window/select-window'
import { projectWindowMessage } from './window-projection'

/** What one new message may add to a live patch before older fragments are left to scrolling. */
export const LIVE_MESSAGE_BUDGET: TranscriptWindowBudget = { maxBytes: 64 * 1024, maxFragments: 24, targetChars: Number.MAX_SAFE_INTEGER }
/** Held windows per connection; the least recently served goes first. */
const MAX_HELD = 16

interface HeldFragment { digest: string; textLength?: number }

interface HeldMessage {
  metaDigest: string
  fragments: Map<string, HeldFragment>
  /** Content-order keys the holder has, contiguous. */
  keys: string[]
  omittedBefore: number
  omittedAfter: number
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

  source(messages: readonly ChatMessage[]): WindowSource {
    let ids: Map<string, number> | undefined
    return {
      count: messages.length,
      at: (index) => this.of(messages[index]),
      indexOf: (messageId) => (ids ??= new Map(messages.map((message, index) => [message.id, index]))).get(messageId) ?? -1,
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

  has(sessionId: string): boolean {
    return (this.sessions.get(sessionId)?.holders.size ?? 0) > 0
  }

  serve(input: {
    sessionId: string
    holder: string
    messages: readonly ChatMessage[]
    request: Pick<TranscriptWindowRequest, 'anchor' | 'direction' | 'have'>
    budget: TranscriptWindowBudget
  }): SelectedWindow & { total: number } {
    const session = this.session(input.sessionId)
    const selected = selectTranscriptWindow(session.fragments.source(input.messages), input.request, input.budget)
    const extend = input.request.anchor && input.request.direction !== 'around' ? input.request.direction ?? 'before' : null
    const previous = session.holders.get(input.holder)
    const held = extend && previous ? previous : { messages: new Map(), order: [], atTail: false, total: 0, seen: new Map() }
    for (const message of selected.messages) {
      const fragments = session.fragments.of(input.messages[message.index])
      recordMessage(held, message, fragments, extend === 'before' ? 'before' : extend === 'after' ? 'after' : null)
      held.seen.set(message.id, input.messages[message.index])
    }
    const ids = selected.messages.map((message) => message.id)
    held.order = extend === 'before' ? [...ids, ...held.order.filter((id) => !ids.includes(id))]
      : extend === 'after' ? [...held.order.filter((id) => !ids.includes(id)), ...ids] : ids
    if (!extend || extend === 'after') held.atTail = selected.newer === null
    held.total = input.messages.length
    session.holders.delete(input.holder)
    session.holders.set(input.holder, held)
    this.evict()
    session.fragments.retain(this.heldIds(input.sessionId))
    return { ...selected, total: input.messages.length }
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
    if (out.length) session.fragments.retain(this.heldIds(sessionId))
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
  if (previous && join === 'before') {
    const keys = [...sent, ...previous.keys.filter((key) => !sent.includes(key))]
    held.messages.set(message.id, { ...previous, metaDigest: message.metaDigest, keys, fragments: record(keys), omittedBefore: message.omittedBefore })
    return
  }
  if (previous && join === 'after') {
    const keys = [...previous.keys.filter((key) => !sent.includes(key)), ...sent]
    held.messages.set(message.id, { ...previous, metaDigest: message.metaDigest, keys, fragments: record(keys), omittedAfter: message.omittedAfter })
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
    const start = present.length ? Math.min(...present.map((id) => index.get(id)!)) : Math.max(0, messages.length - 1)
    range = messages.length ? Array.from({ length: messages.length - start }, (_, i) => start + i) : []
  } else {
    range = present.map((id) => index.get(id)!).sort((a, b) => a - b)
  }
  const changed: TranscriptWindowMessage[] = []
  for (const i of range) {
    const source = messages[i]
    if (held.seen.get(source.id) === source && held.messages.has(source.id)) continue
    const { message, record } = diffMessage(held.messages.get(source.id), fragments.of(source), i)
    held.messages.set(source.id, record)
    held.seen.set(source.id, source)
    if (message) changed.push(message)
  }
  const order = range.map((i) => messages[i].id)
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

function diffMessage(previous: HeldMessage | undefined, current: MessageFragments, index: number): { message: TranscriptWindowMessage | null; record: HeldMessage } {
  const all = current.fragments
  let start: number
  let end = all.length
  if (!previous) {
    start = tailStart(current)
  } else {
    const first = previous.omittedBefore > 0 ? all.findIndex((fragment) => fragment.key === previous.keys[0]) : 0
    start = first < 0 ? tailStart(current) : first
    if (previous.omittedAfter > 0) {
      const last = all.findIndex((fragment) => fragment.key === previous.keys[previous.keys.length - 1])
      if (last >= start) end = last + 1
    }
  }
  const sent: TranscriptWindowFragment[] = all.slice(start, end).map((fragment) => {
    const heldFragment = previous?.fragments.get(fragment.key)
    if (heldFragment?.digest === fragment.digest) return { key: fragment.key, digest: fragment.digest }
    const body = fragment.body
    if (heldFragment?.textLength !== undefined && body.kind === 'text' && body.text.length > heldFragment.textLength
      && fragmentDigest(textBody(body.head, body.offset, body.text.slice(0, heldFragment.textLength), body.context)) === heldFragment.digest) {
      return { key: fragment.key, digest: fragment.digest, append: body.text.slice(heldFragment.textLength) }
    }
    return { key: fragment.key, digest: fragment.digest, body }
  })
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

/** First fragment a new message enters with: as many newest ones as the live budget allows. */
function tailStart(current: MessageFragments): number {
  let bytes = current.metaBytes
  let start = current.fragments.length
  while (start > 0) {
    const next = current.fragments[start - 1]
    if (current.fragments.length - start >= LIVE_MESSAGE_BUDGET.maxFragments || bytes + next.bytes > LIVE_MESSAGE_BUDGET.maxBytes) break
    bytes += next.bytes
    start--
  }
  return start === current.fragments.length && start > 0 ? start - 1 : start
}
