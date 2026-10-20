import type { ChatMessage, ContentBlock, ImageAttachment } from '../agent-types'
import type {
  TranscriptFragmentBody,
  TranscriptWindowAnchor,
  TranscriptWindowCoverage,
  TranscriptWindowMessage,
  TranscriptWindowMeta,
  TranscriptWindowPatch,
  TranscriptWindowResult,
} from '../environment/transcript-window'
import { utf8Length } from './content-digest'
import { fragmentDigest } from './fragment-message'
import { MAX_COVERAGE_PAIRS, windowAnchor } from './select-window'
import { textContextPrefix } from './text-cuts'

export interface WindowStoreFragment {
  key: string
  digest: string
  body: TranscriptFragmentBody
  /** A fold shown past its first pages: the last inner fragment it follows. */
  after?: string
}

/** A message as a client holds it: a contiguous run of its fragments. */
export interface WindowStoreMessage {
  id: string
  index: number
  metaDigest: string
  meta: TranscriptWindowMeta
  fragments: WindowStoreFragment[]
  omittedBefore: number
  omittedAfter: number
}

/** The contiguous window a client holds. */
export interface TranscriptWindowState {
  messages: WindowStoreMessage[]
  older: TranscriptWindowAnchor | null
  newer: TranscriptWindowAnchor | null
  total: number
}

/** Bodies a client kept from earlier windows (its cache), addressed by digest. */
export interface WindowBodyLookup {
  body(messageId: string, key: string, digest: string): TranscriptFragmentBody | undefined
  meta(messageId: string, digest: string): TranscriptWindowMeta | undefined
}

export const EMPTY_WINDOW_LOOKUP: WindowBodyLookup = { body: () => undefined, meta: () => undefined }

/** Looks bodies up in a held window first, then in `fallback`. */
export function windowLookup(state: TranscriptWindowState | null, fallback: WindowBodyLookup = EMPTY_WINDOW_LOOKUP): WindowBodyLookup {
  const byId = new Map(state?.messages.map((message) => [message.id, message]))
  return {
    body: (messageId, key, digest) => byId.get(messageId)?.fragments.find((f) => f.key === key && f.digest === digest)?.body
      ?? fallback.body(messageId, key, digest),
    meta: (messageId, digest) => {
      const held = byId.get(messageId)
      return held?.metaDigest === digest ? held.meta : fallback.meta(messageId, digest)
    },
  }
}

export interface WindowApplyResult {
  state: TranscriptWindowState
  /** Messages whose bodies the client lacked: the window must be fetched again without claiming them. */
  missing: string[]
}

/**
 * Take a window result in. `replace` adopts it as the held window; `older`
 * and `newer` join it to the held window's start or end, merging the message
 * the two share.
 */
export function applyWindowResult(
  state: TranscriptWindowState | null,
  result: Pick<TranscriptWindowResult, 'messages' | 'older' | 'newer' | 'total'>,
  lookup: WindowBodyLookup,
  placement: 'replace' | 'older' | 'newer' = 'replace',
): WindowApplyResult {
  const missing: string[] = []
  const resolved = result.messages.flatMap((message) => {
    const held = resolveMessage(message, undefined, lookup)
    if (!held) missing.push(message.id)
    return held ? [held] : []
  })
  if (missing.length || !state || placement === 'replace') {
    return { state: { messages: resolved, older: result.older, newer: result.newer, total: result.total }, missing }
  }
  if (placement === 'older') {
    return { state: { messages: joinMessages(resolved, state.messages, 'after'), older: result.older, newer: state.newer, total: result.total }, missing }
  }
  return { state: { messages: joinMessages(state.messages, resolved, 'before'), older: state.older, newer: result.newer, total: result.total }, missing }
}

/**
 * Two adjacent runs; a message they share keeps the held run's meta, as the
 * host records it, and gains the page's fragments.
 */
function joinMessages(before: WindowStoreMessage[], after: WindowStoreMessage[], held: 'before' | 'after'): WindowStoreMessage[] {
  const last = before[before.length - 1]
  const first = after[0]
  if (!last || !first || last.id !== first.id) return [...before, ...after.filter((message) => !before.some((b) => b.id === message.id))]
  const lastKeys = new Set(last.fragments.map((fragment) => fragment.key))
  const firstKeys = new Set(first.fragments.map((fragment) => fragment.key))
  const shared: WindowStoreMessage = {
    ...(held === 'before' ? last : first),
    fragments: held === 'before'
      ? [...last.fragments, ...first.fragments.filter((fragment) => !lastKeys.has(fragment.key))]
      : [...last.fragments.filter((fragment) => !firstKeys.has(fragment.key)), ...first.fragments],
    omittedBefore: last.omittedBefore,
    omittedAfter: first.omittedAfter,
  }
  return [...before.slice(0, -1), shared, ...after.slice(1)]
}

export interface WindowPatchResult {
  state: TranscriptWindowState
  /** A fragment or meta could not be rebuilt: the held window must be fetched again. */
  stale: boolean
}

/** Apply a live patch to the held window; digests make a repeated patch a no-op. */
export function applyWindowPatch(state: TranscriptWindowState, patch: TranscriptWindowPatch, lookup: WindowBodyLookup = EMPTY_WINDOW_LOOKUP): WindowPatchResult {
  let stale = false
  const removed = new Set(patch.removed ?? [])
  const byId = new Map(state.messages.filter((message) => !removed.has(message.id)).map((message) => [message.id, message]))
  const added: WindowStoreMessage[] = []
  for (const message of patch.messages) {
    const existing = byId.get(message.id)
    const next = resolveMessage(message, existing, lookup)
    if (!next) { stale = true; continue }
    if (!existing) added.push(next)
    byId.set(message.id, next)
  }
  let messages: WindowStoreMessage[]
  if (patch.order) {
    messages = patch.order.flatMap((id) => {
      const message = byId.get(id)
      if (!message) stale = true
      return message ? [message] : []
    })
  } else {
    messages = state.messages.filter((message) => !removed.has(message.id)).map((message) => byId.get(message.id)!)
    messages.push(...added.sort((a, b) => a.index - b.index))
  }
  // A message that entered with only its newest fragments, or a removed first message, moves where older pages start.
  const first = messages[0]
  const older = !first ? state.older : first.index === 0 && first.omittedBefore === 0 ? null : windowAnchor(first, 'first')
  return { state: { ...state, messages, older, total: patch.total }, stale }
}

function resolveMessage(message: TranscriptWindowMessage, existing: WindowStoreMessage | undefined, lookup: WindowBodyLookup): WindowStoreMessage | null {
  const meta = message.meta ?? (existing?.metaDigest === message.metaDigest ? existing.meta : lookup.meta(message.id, message.metaDigest))
  if (!meta) return null
  const fragments: WindowStoreFragment[] = []
  for (const fragment of message.fragments) {
    const held = existing?.fragments.find((candidate) => candidate.key === fragment.key)
    let body = fragment.body
    if (!body && fragment.append !== undefined && held?.body.kind === 'text') {
      const grown: TranscriptFragmentBody = { ...held.body, text: held.body.text + fragment.append }
      if (fragmentDigest(grown) === fragment.digest) body = grown
    }
    if (!body && held?.digest === fragment.digest) body = held.body
    body ??= lookup.body(message.id, fragment.key, fragment.digest)
    if (!body) return null
    fragments.push(held?.digest === fragment.digest ? held : { key: fragment.key, digest: fragment.digest, body })
  }
  const unchanged = existing && existing.metaDigest === message.metaDigest && existing.index === message.index
    && existing.omittedBefore === message.omittedBefore && existing.omittedAfter === message.omittedAfter
    && existing.fragments.length === fragments.length && fragments.every((fragment, i) => fragment === existing.fragments[i])
  if (unchanged) return existing
  return {
    id: message.id,
    index: message.index,
    metaDigest: message.metaDigest,
    meta,
    fragments,
    omittedBefore: message.omittedBefore,
    omittedAfter: message.omittedAfter,
  }
}

const materialized = new WeakMap<WindowStoreMessage, ChatMessage>()

/**
 * The renderable message for a held one. A partial message is marked with
 * `metadata.window` and never mistaken for the complete one: copy and export
 * fetch the whole message. The same held object yields the same message, so
 * identity-based paint diffs still see only what changed.
 */
export function materializeWindowMessage(message: WindowStoreMessage): ChatMessage {
  const cached = materialized.get(message)
  if (cached) return cached
  const content: ContentBlock[] = []
  const attachments: ImageAttachment[] = []
  let textBlock: string | null = null
  for (const fragment of message.fragments) {
    const body = fragment.body
    if (body.kind === 'attachment') { attachments.push(body.attachment); textBlock = null; continue }
    if (body.kind === 'block') { content.push(body.block); textBlock = null; continue }
    if (body.kind === 'omitted') {
      content.push({ type: 'notice', id: `window:${fragment.key}`, level: 'info', kind: 'omitted', text: '' })
      textBlock = null
      continue
    }
    if (body.kind === 'fold') {
      content.push({ type: 'notice', id: `window:${fragment.key}`, level: 'info', kind: 'fold', text: '',
        fold: { ...body.summary, messageId: message.id, key: fragment.key, revision: body.revision, ...(fragment.after ? { after: fragment.after } : {}) } })
      textBlock = null
      continue
    }
    const block = fragment.key.slice(0, fragment.key.lastIndexOf('~'))
    const last = content[content.length - 1]
    if (textBlock === block && last && (last.type === 'text' || last.type === 'plan')) {
      content[content.length - 1] = { ...last, text: last.text + body.text }
    } else {
      content.push({ ...body.head, text: textContextPrefix(body.context) + body.text } as ContentBlock)
      textBlock = block
    }
  }
  const partial = message.omittedBefore > 0 || message.omittedAfter > 0
  const metadata = message.meta.metadata && partial
    ? (({ transcriptBoundary: _boundary, ...rest }) => rest)(message.meta.metadata)
    : message.meta.metadata
  const result: ChatMessage = {
    ...message.meta,
    content,
    ...(attachments.length ? { attachments } : {}),
    ...(metadata || partial ? {
      metadata: { ...metadata, ...(partial ? { window: { omittedBefore: message.omittedBefore, omittedAfter: message.omittedAfter } } : {}) },
    } : {}),
  }
  if (!result.metadata) delete result.metadata
  materialized.set(message, result)
  return result
}

/** Coverage of the held window, newest first, bounded to what a host reads. */
export function windowCoverage(messages: readonly WindowStoreMessage[]): TranscriptWindowCoverage[] {
  const coverage: TranscriptWindowCoverage[] = []
  let pairs = 0
  for (let i = messages.length - 1; i >= 0 && pairs < MAX_COVERAGE_PAIRS; i--) {
    const message = messages[i]
    const f: Array<[string, string]> = []
    for (let j = message.fragments.length - 1; j >= 0 && pairs < MAX_COVERAGE_PAIRS; j--, pairs++) {
      f.unshift([message.fragments[j].key, message.fragments[j].digest])
    }
    coverage.push({ id: message.id, meta: message.metaDigest, f })
  }
  return coverage
}

/**
 * Drop the oldest held fragments until the bodies fit `maxBytes`. The newest
 * fragment always stays; the window's start moves to the first one kept.
 */
export function trimWindowState(state: TranscriptWindowState, maxBytes: number): TranscriptWindowState {
  let bytes = 0
  const kept: WindowStoreMessage[] = []
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]
    bytes += utf8Length(JSON.stringify(message.meta))
    let start = message.fragments.length
    while (start > 0) {
      const size = utf8Length(JSON.stringify(message.fragments[start - 1].body))
      if (bytes + size > maxBytes && (kept.length || start < message.fragments.length)) break
      bytes += size
      start--
    }
    if (start === 0) { kept.unshift(message); continue }
    if (start < message.fragments.length) {
      kept.unshift({ ...message, fragments: message.fragments.slice(start), omittedBefore: message.omittedBefore + start })
    }
    const first = kept[0]
    return { ...state, messages: kept, older: first ? windowAnchor(first, 'first') : state.older }
  }
  return state
}
