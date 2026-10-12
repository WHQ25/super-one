import type {
  TranscriptWindowAnchor,
  TranscriptWindowBudget,
  TranscriptWindowCoverage,
  TranscriptWindowFragment,
  TranscriptWindowMessage,
  TranscriptWindowRequest,
} from '../environment/transcript-window'
import { MAX_FRAGMENT_BYTES, MAX_META_BYTES, type MessageFragments } from './fragment-message'

export const DEFAULT_WINDOW_BUDGET: TranscriptWindowBudget = { maxBytes: 128 * 1024, maxFragments: 48, targetChars: 6000 }
/** A window always fits one fragment and its meta. */
export const MIN_WINDOW_BYTES = MAX_FRAGMENT_BYTES + MAX_META_BYTES + 1024
export const MAX_WINDOW_BYTES = 1024 * 1024
const MAX_WINDOW_FRAGMENTS = 256
const MAX_TARGET_CHARS = 200_000
/** Screens of text a window aims for: the visible one plus overscan. */
const VIEWPORT_SCREENS = 3
/** Rough phone body text cell, CSS px. */
const CHAR_WIDTH = 8
const LINE_HEIGHT = 22
/** Serialized cost of a fragment sent without its body. */
const REF_BYTES = 48

/** A request's budget, clamped to the host's limits. */
export function windowBudget(request: Pick<TranscriptWindowRequest, 'budget' | 'viewport'>): TranscriptWindowBudget {
  const asked = request.budget ?? {}
  const viewportChars = request.viewport && request.viewport.width > 0 && request.viewport.height > 0
    ? Math.round((request.viewport.width / CHAR_WIDTH) * (request.viewport.height / LINE_HEIGHT) * VIEWPORT_SCREENS)
    : undefined
  return {
    maxBytes: clamp(asked.maxBytes ?? DEFAULT_WINDOW_BUDGET.maxBytes, MIN_WINDOW_BYTES, MAX_WINDOW_BYTES),
    maxFragments: clamp(asked.maxFragments ?? DEFAULT_WINDOW_BUDGET.maxFragments, 1, MAX_WINDOW_FRAGMENTS),
    targetChars: clamp(asked.targetChars ?? viewportChars ?? DEFAULT_WINDOW_BUDGET.targetChars, 1, MAX_TARGET_CHARS),
  }
}

export interface WindowSource {
  /** Messages in the transcript. */
  count: number
  /** Projected, fragmented message at an index; called lazily, newest first for a tail window. */
  at(index: number): MessageFragments
  /** Index of a message id, or -1. */
  indexOf(messageId: string): number
}

export interface SelectedWindow {
  messages: TranscriptWindowMessage[]
  older: TranscriptWindowAnchor | null
  newer: TranscriptWindowAnchor | null
}

/** A unit of a window: one fragment, or a message that has none. */
interface Position { message: number; fragment: number }

/**
 * The fragments a window request covers, under its budget. A tail or `before`
 * window walks back from its anchor, `after` walks forward, and `around` starts
 * at the anchor's message and fills forward, then back. Fragments the client
 * holds with the same digest cost a reference instead of a body, and count
 * toward the visible-text target like any other.
 */
export function selectTranscriptWindow(
  source: WindowSource,
  request: Pick<TranscriptWindowRequest, 'anchor' | 'direction' | 'have'>,
  budget: TranscriptWindowBudget,
): SelectedWindow {
  if (source.count === 0) return { messages: [], older: null, newer: null }
  const have = coverageMap(request.have)
  const units = (index: number) => Math.max(1, source.at(index).fragments.length)
  const selected = new Map<number, { first: number; last: number }>()
  let bytes = 0
  let chars = 0
  let count = 0
  const take = (position: Position): boolean => {
    const message = source.at(position.message)
    const held = have.get(message.id)
    const fragment = message.fragments[position.fragment]
    let cost = fragment ? (held?.f.get(fragment.key) === fragment.digest ? REF_BYTES : fragment.bytes + REF_BYTES) : 0
    if (!selected.has(position.message)) cost += held?.meta === message.metaDigest ? REF_BYTES : message.metaBytes + REF_BYTES
    if (count > 0 && (count >= budget.maxFragments || bytes + cost > budget.maxBytes)) return false
    const range = selected.get(position.message)
    selected.set(position.message, range
      ? { first: Math.min(range.first, position.fragment), last: Math.max(range.last, position.fragment) }
      : { first: position.fragment, last: position.fragment })
    bytes += cost
    chars += fragment?.chars ?? 0
    count++
    return chars < budget.targetChars
  }
  const walk = (from: Position | null, step: (position: Position) => Position | null): boolean => {
    for (let position = from; position; position = step(position)) if (!take(position)) return false
    return true
  }
  const previous = (position: Position): Position | null => position.fragment > 0
    ? { message: position.message, fragment: position.fragment - 1 }
    : position.message > 0 ? { message: position.message - 1, fragment: units(position.message - 1) - 1 } : null
  const next = (position: Position): Position | null => position.fragment < units(position.message) - 1
    ? { message: position.message, fragment: position.fragment + 1 }
    : position.message < source.count - 1 ? { message: position.message + 1, fragment: 0 } : null

  const direction = request.direction ?? 'before'
  if (!request.anchor) {
    const last = source.count - 1
    walk({ message: last, fragment: units(last) - 1 }, previous)
  } else {
    const index = source.indexOf(request.anchor.messageId)
    if (index < 0) throw Object.assign(new Error('History message no longer exists'), { code: 'not_found' })
    const key = request.anchor.key
    const keyed = key === undefined ? -1 : source.at(index).fragments.findIndex((f) => f.key === key)
    // Without a key the anchor is the message's edge; a key that no longer exists (the message
    // was rewritten) pages from the message's far edge, so none of it is skipped.
    const lost = key !== undefined && keyed < 0
    if (direction === 'before') walk(previous({ message: index, fragment: keyed >= 0 ? keyed : lost ? units(index) : 0 }), previous)
    else if (direction === 'after') walk(next({ message: index, fragment: keyed >= 0 ? keyed : lost ? -1 : units(index) - 1 }), next)
    else if (walk({ message: index, fragment: 0 }, next)) walk(previous({ message: index, fragment: 0 }), previous)
  }

  const indexes = [...selected.keys()].sort((a, b) => a - b)
  const messages = indexes.map((index): TranscriptWindowMessage => {
    const message = source.at(index)
    const range = selected.get(index)!
    const held = have.get(message.id)
    const fragments = message.fragments.slice(range.first, range.last + 1).map((fragment): TranscriptWindowFragment =>
      held?.f.get(fragment.key) === fragment.digest
        ? { key: fragment.key, digest: fragment.digest }
        : { key: fragment.key, digest: fragment.digest, body: fragment.body })
    const total = message.fragments.length
    return {
      id: message.id,
      index,
      metaDigest: message.metaDigest,
      ...(held?.meta === message.metaDigest ? {} : { meta: message.meta }),
      fragments,
      omittedBefore: total ? range.first : 0,
      omittedAfter: total ? total - range.last - 1 : 0,
    }
  })
  const first = messages[0]
  const last = messages[messages.length - 1]
  if (!first || !last) return { messages: [], older: null, newer: null }
  const startsAtTop = first.index === 0 && first.omittedBefore === 0
  const endsAtTail = last.index === source.count - 1 && last.omittedAfter === 0
  return {
    messages,
    older: startsAtTop ? null : anchorOf(first, 'first'),
    newer: endsAtTail ? null : anchorOf(last, 'last'),
  }
}

function anchorOf(message: TranscriptWindowMessage, edge: 'first' | 'last'): TranscriptWindowAnchor {
  const fragment = edge === 'first' ? message.fragments[0] : message.fragments[message.fragments.length - 1]
  return fragment ? { messageId: message.id, key: fragment.key } : { messageId: message.id }
}

/** Coverage a host reads; a client sends its held window, which never needs more. */
export const MAX_COVERAGE_PAIRS = 2 * MAX_WINDOW_FRAGMENTS

function coverageMap(have: TranscriptWindowCoverage[] | undefined): Map<string, { meta?: string; f: Map<string, string> }> {
  const map = new Map<string, { meta?: string; f: Map<string, string> }>()
  let pairs = 0
  for (const entry of Array.isArray(have) ? have : []) {
    if (pairs >= MAX_COVERAGE_PAIRS) break
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.f)) continue
    const f = new Map<string, string>()
    for (const pair of entry.f) {
      if (++pairs > MAX_COVERAGE_PAIRS) break
      if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') f.set(pair[0], pair[1])
    }
    map.set(entry.id, { ...(typeof entry.meta === 'string' ? { meta: entry.meta } : {}), f })
  }
  return map
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min
}
