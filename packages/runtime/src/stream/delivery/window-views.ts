import type { ChatMessage } from '@superone/shared/agent-types'
import { readableContent } from '@superone/shared/codex-content'
import type {
  TranscriptFoldRequest,
  TranscriptFoldResult,
  TranscriptWindowBudget,
  TranscriptWindowFragment,
  TranscriptWindowMessage,
  TranscriptWindowPatch,
  TranscriptWindowRequest,
} from '@superone/shared/environment/transcript-window'
import { boundaryCursor } from '@superone/shared/transcript-boundary'
import { contentDigest, utf8Length } from '@superone/shared/transcript-window/content-digest'
import { foldMessageFragments, foldRevision, selectFoldPage, type FoldedFragments } from '@superone/shared/transcript-window/folds'
import { fragmentDigest, MessageFragmenter, textBody, type FragmentEntry, type MessageFragments } from '@superone/shared/transcript-window/fragment-message'
import { selectTranscriptWindow, windowAnchor, type SelectedWindow, type WindowSource } from '@superone/shared/transcript-window/select-window'
import { planProcessFolds, type ProcessFoldPlan } from '@superone/chat-core/turn-process/process-folds'
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
  /** The holder takes folds, so its window and patches cut settled process down to them. */
  folds: boolean
}

interface FoldedView { fragments: FoldedFragments; plan: ProcessFoldPlan }

/** One session's fragmenting, shared by its holders on a connection. */
class SessionFragments {
  /** Times a message was fragmented and planned. A reparsed copy of the same content does not count. */
  plans = 0
  /** Transcript the current serve or patch is reading, so a boundary can find the message it cuts. */
  private transcript: TranscriptAccess | null = null
  private readonly fragmenter = new MessageFragmenter()
  private readonly cache = new WeakMap<ChatMessage, { projected: ChatMessage; fragments: MessageFragments }>()
  private readonly foldedCache = new WeakMap<ChatMessage, { cutKey: string; view: FoldedView }>()
  /** Last plan for a message id, so a newly parsed row does not plan the message again. */
  private readonly bySignature = new Map<string, { contentKey: string; cutKey: string; view: FoldedView }>()

  bind(transcript: TranscriptAccess): void {
    this.transcript = transcript
  }

  of(message: ChatMessage, folds = false, cuts?: readonly ChatMessage[]): MessageFragments {
    const prepared = this.cursorMessage(message)
    // The compact row is not a process fold. Its cursor is read again on every
    // pass: the row's object stays put while the turn it cuts keeps growing,
    // and a cached edge would leave the marker at the end of the reply.
    if (prepared !== message) return this.fragmenter.fragment(projectWindowMessage(prepared))
    return folds ? this.folded(message, cuts).fragments : this.entry(message).fragments
  }

  /** Wire copy of a boundary row. The stored message, and the cuts fold planning reads, stay the full map. */
  private cursorMessage(message: ChatMessage): ChatMessage {
    const boundary = message.metadata?.transcriptBoundary
    if (!boundary || boundary.cursor || !this.transcript) return message
    const index = this.transcript.indexOf(boundary.messageId)
    if (index < 0) return message
    let source: ChatMessage
    try {
      source = this.transcript.messageAt(index)
    } catch {
      return message
    }
    const cursor = boundaryCursor(boundary, source)
    if (cursor === boundary) return message
    return { ...message, metadata: { ...message.metadata, transcriptBoundary: cursor } }
  }

  /**
   * The message with the process its settled turn collapses cut down to folds.
   * `cuts` are the other rows that split this turn. A later read of the same
   * content, parsed into a new object, reuses the plan; pass `cuts` only when
   * they may have changed.
   */
  folded(message: ChatMessage, cuts?: readonly ChatMessage[]): FoldedView {
    const cutKey = foldCutKey(cuts)
    const cached = this.foldedCache.get(message)
    // A page read omits the cuts and keeps the plan the window was cut with.
    // A new cut on the same object plans again. A streaming object can grow in
    // place, so its tail is folded again instead of reusing the first view.
    if (cached && message.status !== 'streaming' && (cuts === undefined || cached.cutKey === cutKey)) return cached.view
    const contentKey = foldContentKey(message)
    const stored = this.bySignature.get(message.id)
    if (stored && stored.contentKey === contentKey && (cuts === undefined || stored.cutKey === cutKey)) {
      this.foldedCache.set(message, { cutKey: stored.cutKey, view: stored.view })
      return stored.view
    }
    this.plans++
    const { projected, fragments } = this.entry(message)
    // Fragment block indexes count `readableContent`; the plan reads the same blocks.
    const content = readableContent(projected)
    const planning = content === projected.content ? projected : { ...projected, content: [...content] }
    const plan = planProcessFolds(planning, cuts?.length ? { cuts } : undefined)
    const folded = foldMessageFragments(fragments, plan.ranges)
    if (plan.liveFrom !== undefined && plan.liveFrom > 0) {
      const at = folded.blocks.findIndex((block) => block >= plan.liveFrom!)
      folded.livePin = at < 0 ? folded.fragments.length : at
    }
    const view = { fragments: folded, plan }
    this.bySignature.set(message.id, { contentKey, cutKey, view })
    this.foldedCache.set(message, { cutKey, view })
    return view
  }

  source(transcript: TranscriptAccess, folds = false, cuts?: ReadonlyMap<string, readonly ChatMessage[]>): WindowSource {
    return {
      count: transcript.count,
      at: (index) => {
        const message = transcript.messageAt(index)
        return this.of(message, folds, cuts?.get(message.id))
      },
      indexOf: (messageId) => transcript.indexOf(messageId),
    }
  }

  private entry(message: ChatMessage): { projected: ChatMessage; fragments: MessageFragments } {
    let entry = this.cache.get(message)
    if (!entry) {
      const projected = projectWindowMessage(message)
      entry = { projected, fragments: this.fragmenter.fragment(projected) }
      this.cache.set(message, entry)
    }
    return entry
  }

  retain(messages: Iterable<string>): void {
    const keep = new Set(messages)
    this.fragmenter.retain(keep)
    for (const id of this.bySignature.keys()) if (!keep.has(id)) this.bySignature.delete(id)
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
  /** Fold plans for a session this connection has not opened a window on yet. */
  private readonly spare = new Map<string, SessionFragments>()
  /** Holders the 64-window cap dropped since the last drain. Switching a holder off a session is not an eviction. */
  private readonly evicted: EvictedWindowHolder[] = []

  has(sessionId: string): boolean {
    return (this.sessions.get(sessionId)?.holders.size ?? 0) > 0
  }

  /** How many times this connection fragmented a message to plan its folds. */
  plannedFolds(sessionId: string): number {
    return this.fragmentsFor(sessionId).plans
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
    request: Pick<TranscriptWindowRequest, 'anchor' | 'direction' | 'have' | 'folds'>
    budget: TranscriptWindowBudget
  }): SelectedWindow & { total: number } {
    const transcript = input.transcript ?? (input.messages ? arrayTranscript(input.messages) : null)
    if (!transcript) throw new Error('transcript window needs messages')
    const folds = input.request.folds === true
    const session = this.session(input.sessionId)
    session.fragments.bind(transcript)
    const cuts = boundaryCuts(input.messages ?? transcript.boundaryMessages?.() ?? [])
    const selected = selectTranscriptWindow(session.fragments.source(transcript, folds, cuts), input.request, input.budget)
    const extend = input.request.anchor && input.request.direction !== 'around' ? input.request.direction ?? 'before' : null
    const previous = session.holders.get(input.holder)
    const held: HeldWindow = extend && previous?.folds === folds ? previous
      : { messages: new Map(), order: [], atTail: false, total: 0, seen: new Map(), folds }
    // A fresh tail keeps each streaming turn's closed intervals. A page the
    // user asked for stays the contiguous range they anchored. The newest-first
    // walk can fill the budget with the reply before it reaches the compact
    // rows stored ahead of it; those rows are put back so a cold open matches
    // the live patch.
    const liveBudget = Math.min(input.budget.maxBytes, LIVE_MESSAGE_BUDGET.maxBytes)
    if (!extend) {
      selected.messages = selected.messages.map((message) => {
        const source = transcript.messageAt(message.index)
        return clipWindowMessage(message, session.fragments.of(source, folds, cuts.get(source.id)), liveBudget)
      })
      selected.messages = withCuttingRows(selected.messages, transcript, session.fragments, folds, cuts)
      const first = selected.messages[0]
      const last = selected.messages[selected.messages.length - 1]
      if (first && last) {
        selected.older = first.index === 0 && first.omittedBefore === 0 ? null : windowAnchor(first, 'first')
        selected.newer = last.index === transcript.count - 1 && last.omittedAfter === 0 ? null : windowAnchor(last, 'last')
      }
    }
    for (const message of selected.messages) {
      const source = transcript.messageAt(message.index)
      const fragments = session.fragments.of(source, folds, cuts.get(source.id))
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
    session.fragments.bind(arrayTranscript(messages))
    const cuts = boundaryCuts(messages)
    const out: Array<{ holder: string; patch: TranscriptWindowPatch }> = []
    for (const [holder, held] of session.holders) {
      const patch = diffHeld(held, messages, session.fragments, cuts)
      if (patch) out.push({ holder, patch })
    }
    if (out.length) {
      session.fragments.retain(this.heldIds(sessionId))
      this.touch(sessionId)
    }
    return out
  }

  /**
   * The page behind fold `request.fold` of `message`, cut as this
   * connection's windows cut it. It changes no held window: the fold stays
   * one fragment there, and its pages live with the client.
   */
  fold(sessionId: string, message: ChatMessage, request: Pick<TranscriptFoldRequest, 'fold' | 'revision' | 'after'>, budget: TranscriptWindowBudget): TranscriptFoldResult {
    const fragments = this.fragmentsFor(sessionId)
    const view = fragments.folded(message)
    // With no window to retain against, keep only the message being paged.
    if (!this.sessions.has(sessionId)) fragments.retain([message.id])
    const inner = view.fragments.folds.get(request.fold)
    if (!inner) throw Object.assign(new Error('Fold no longer exists'), { code: 'not_found' })
    if (foldRevision(inner.entries) !== request.revision) throw Object.assign(new Error('Fold changed'), { code: 'failed_precondition' })
    const page = selectFoldPage(inner, request.after, budget)
    if (!page) throw Object.assign(new Error('Fold page anchor no longer exists'), { code: 'not_found' })
    const rest = page.end < inner.entries.length
      ? { ...view.plan.summarize(inner.blocks[page.end], inner.blocks[inner.blocks.length - 1]), fragments: inner.entries.length - page.end }
      : null
    return {
      sessionId,
      messageId: message.id,
      fold: request.fold,
      revision: request.revision,
      fragments: inner.entries.slice(page.start, page.end).map(({ key, digest, body }) => ({ key, digest, body })),
      rest,
    }
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
    if (!session) {
      const fragments = this.spare.get(sessionId) ?? new SessionFragments()
      this.spare.delete(sessionId)
      this.sessions.set(sessionId, session = { fragments, holders: new Map() })
    }
    return session
  }

  /** The fragmenter a window already holds, or the one fold pages keep warm. */
  private fragmentsFor(sessionId: string): SessionFragments {
    const held = this.sessions.get(sessionId)
    if (held) return held.fragments
    let fragments = this.spare.get(sessionId)
    if (!fragments) {
      fragments = new SessionFragments()
      this.spare.set(sessionId, fragments)
      while (this.spare.size > MAX_HELD) {
        const oldest = this.spare.keys().next().value
        if (oldest === undefined) break
        this.spare.delete(oldest)
      }
    }
    return fragments
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

function boundaryCuts(messages: readonly ChatMessage[]): Map<string, ChatMessage[]> {
  const cuts = new Map<string, ChatMessage[]>()
  for (const message of messages) {
    const id = message.metadata?.transcriptBoundary?.messageId
    if (!id || id === message.id) continue
    const list = cuts.get(id)
    if (list) list.push(message)
    else cuts.set(id, [message])
  }
  return cuts
}

function foldContentKey(message: ChatMessage): string {
  return contentDigest(JSON.stringify([message.role, message.status, readableContent(message)]))
}

function foldCutKey(cuts: readonly ChatMessage[] | undefined): string {
  if (!cuts?.length) return ''
  return cuts.map((cut) => {
    const boundary = cut.metadata?.transcriptBoundary
    return `${cut.id}:${boundary?.order ?? ''}:${JSON.stringify(boundary?.content ?? {})}`
  }).join('|')
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
function diffHeld(held: HeldWindow, messages: readonly ChatMessage[], fragments: SessionFragments, cuts: ReadonlyMap<string, readonly ChatMessage[]>): TranscriptWindowPatch | null {
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
    // The compact row keeps its object while the turn it cuts keeps growing, so its edge is read again.
    if (held.seen.get(source.id) === source && held.messages.has(source.id) && !source.metadata?.transcriptBoundary) continue
    const { message, record } = diffMessage(held.messages.get(source.id), fragments.of(source, held.folds, cuts.get(source.id)), range[r], Math.max(0, Math.min(LIVE_MESSAGE_BUDGET.maxBytes, remaining)))
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
  // A streaming turn with compactions keeps its closed prefix. A paged window
  // (something still follows the held range) stays on the contiguous path.
  const pin = livePin(current)
  if (pin > 0 && !(previous && previous.omittedAfter > 0)) return diffClipped(previous, current, index, maxBytes, pin)
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

/** Fragment index of a streaming suffix. `0` when this message is not a closed-prefix view. */
function livePin(fragments: MessageFragments): number {
  const pin = (fragments as FoldedFragments).livePin ?? 0
  if (pin <= 0) return 0
  return Math.min(pin, fragments.fragments.length)
}

/**
 * Closed prefix plus the newest suffix fragments that fit. The prefix is the
 * detail before and between compactions; the suffix is what is still streaming.
 * A gap in the suffix is not a contiguous index, so `omittedBefore` only marks
 * the message partial (copy still fetches the whole turn).
 */
function clipLive(current: MessageFragments, pin: number, maxBytes: number): { entries: FragmentEntry[]; omittedBefore: number } {
  const all = current.fragments
  const closedEnd = Math.min(pin, all.length)
  const room = Math.max(0, maxBytes - current.metaBytes)
  const suffix = all.slice(closedEnd)
  const reserve = suffix.length ? Math.min(suffix[suffix.length - 1].bytes, room) : 0
  const closedBudget = Math.max(0, room - reserve)
  let closedStart = closedEnd
  let closedBytes = 0
  while (closedStart > 0) {
    const next = all[closedStart - 1]
    if (closedBytes + next.bytes > closedBudget && closedEnd - closedStart > 0) break
    closedBytes += next.bytes
    closedStart--
  }
  const suffixBudget = Math.max(0, room - closedBytes)
  let suffixStart = suffix.length
  let suffixBytes = 0
  let suffixCount = 0
  while (suffixStart > 0) {
    const next = suffix[suffixStart - 1]
    if (suffixCount > 0 && (suffixCount >= LIVE_MESSAGE_BUDGET.maxFragments || suffixBytes + next.bytes > suffixBudget)) break
    suffixBytes += next.bytes
    suffixCount++
    suffixStart--
  }
  const gapped = suffixStart > 0
  return {
    entries: [...all.slice(closedStart, closedEnd), ...suffix.slice(suffixStart)],
    omittedBefore: gapped ? Math.max(closedStart, 1) : closedStart,
  }
}

function wireFragment(fragment: FragmentEntry): TranscriptWindowFragment {
  return {
    key: fragment.key,
    digest: fragment.digest,
    ...(fragment.contentKey ? { contentKey: fragment.contentKey } : {}),
    body: fragment.body,
  }
}

/**
 * Compact rows of a live-pinned reply that the budget walk never reached.
 * They are one fragment each and name the cuts. A settled tail does not pull
 * them back: chips above an omitted head stay hidden until the user pages up.
 */
function withCuttingRows(
  messages: TranscriptWindowMessage[],
  transcript: TranscriptAccess,
  fragments: SessionFragments,
  folds: boolean,
  cuts: ReadonlyMap<string, readonly ChatMessage[]>,
): TranscriptWindowMessage[] {
  const held = new Set(messages.map((message) => message.id))
  const added: TranscriptWindowMessage[] = []
  for (const message of messages) {
    const source = transcript.messageAt(message.index)
    if (!livePin(fragments.of(source, folds, cuts.get(source.id)))) continue
    for (const cut of cuts.get(source.id) ?? []) {
      if (held.has(cut.id)) continue
      const index = transcript.indexOf(cut.id)
      if (index < 0) continue
      const row = transcript.messageAt(index)
      const view = fragments.of(row, folds, cuts.get(row.id))
      added.push({
        id: view.id,
        index,
        metaDigest: view.metaDigest,
        meta: view.meta,
        fragments: view.fragments.map(wireFragment),
        omittedBefore: 0,
        omittedAfter: 0,
      })
      held.add(cut.id)
    }
  }
  if (!added.length) return messages
  return [...messages, ...added].sort((a, b) => a.index - b.index)
}

/** A fresh tail replaces a streaming turn's selected slice with its closed prefix and live suffix. */
function clipWindowMessage(message: TranscriptWindowMessage, fragments: MessageFragments, maxBytes: number): TranscriptWindowMessage {
  const pin = livePin(fragments)
  if (!pin) return message
  const clip = clipLive(fragments, pin, maxBytes)
  return { ...message, fragments: clip.entries.map(wireFragment), omittedBefore: clip.omittedBefore, omittedAfter: 0 }
}

function diffClipped(
  previous: HeldMessage | undefined,
  current: MessageFragments,
  index: number,
  maxBytes: number,
  pin: number,
): { message: TranscriptWindowMessage | null; record: HeldMessage } {
  const clip = clipLive(current, pin, maxBytes)
  const sent = diffFragments(previous, clip.entries)
  const metaHeld = previous?.metaDigest === current.metaDigest
  const omittedBefore = clip.omittedBefore
  const unchanged = previous && metaHeld && previous.omittedBefore === omittedBefore && previous.omittedAfter === 0
    && previous.keys.length === sent.length
    && sent.every((fragment, i) => !fragment.body && fragment.append === undefined && previous.keys[i] === fragment.key)
  const record: HeldMessage = {
    metaDigest: current.metaDigest,
    keys: sent.map((fragment) => fragment.key),
    fragments: new Map(clip.entries.map((fragment) => [fragment.key, heldFragment(fragment.digest, fragment.body)])),
    omittedBefore,
    omittedAfter: 0,
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
      omittedAfter: 0,
    },
  }
}

/** Each fragment as a reference, an appended tail, or a new body, against what the client holds. */
function diffFragments(previous: HeldMessage | undefined, fragments: MessageFragments['fragments']): TranscriptWindowFragment[] {
  return fragments.map((fragment) => {
    const heldFragment = previous?.fragments.get(fragment.key)
    const contentKey = fragment.contentKey ? { contentKey: fragment.contentKey } : {}
    if (heldFragment?.digest === fragment.digest) return { key: fragment.key, digest: fragment.digest, ...contentKey }
    const body = fragment.body
    if (heldFragment?.textLength !== undefined && body.kind === 'text' && body.text.length > heldFragment.textLength
      && fragmentDigest(textBody(body.head, body.offset, body.text.slice(0, heldFragment.textLength), body.context)) === heldFragment.digest) {
      return { key: fragment.key, digest: fragment.digest, append: body.text.slice(heldFragment.textLength), ...contentKey }
    }
    return { key: fragment.key, digest: fragment.digest, body, ...contentKey }
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
