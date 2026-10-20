import type { ChatMessage, ProcessFoldSummary } from '../agent-types'
import type { TranscriptFoldResult, TranscriptWindowPatch, TranscriptWindowResult } from '../environment/transcript-window'
import { FOLD_KEY_PREFIX, foldRevision } from './folds'
import {
  applyWindowPatch,
  applyWindowResult,
  materializeWindowMessage,
  trimWindowState,
  windowLookup,
  type TranscriptWindowState,
  type WindowStoreFragment,
  type WindowStoreMessage,
} from './window-store'

/** What a client loaded behind one fold: its first pages, and the fold past them. */
interface FoldExpansion {
  revision: string
  fragments: WindowStoreFragment[]
  /** Null once the whole fold is loaded. */
  rest: ProcessFoldSummary | null
}

/** A cached window per session; the blob pool's LRU bounds the total. */
export const WINDOW_CACHE_BYTES = 2 * 1024 * 1024

/**
 * The transcript window a client holds for one session. The window is the
 * source of transcript content: `reconcile` rebuilds the session's messages
 * from it, keeping only rows the client made itself (an optimistic bubble, a
 * send the host never took) until the window carries them.
 */
export class TranscriptWindowSync {
  private local = new Set<string>()
  private materialized: { state: TranscriptWindowState; folds: ReadonlyMap<string, ReadonlyMap<string, FoldExpansion>>; messages: ChatMessage[] } | null = null
  /** Loaded fold pages per message id, then fold key. Replaced, never mutated, so a message's map identifies its splice. */
  private folds: ReadonlyMap<string, ReadonlyMap<string, FoldExpansion>> = new Map()
  private readonly spliced = new WeakMap<WindowStoreMessage, { folds: ReadonlyMap<string, FoldExpansion>; message: WindowStoreMessage }>()

  constructor(private state: TranscriptWindowState) {}

  get current(): TranscriptWindowState { return this.state }
  get hasOlder(): boolean { return this.state.older !== null }
  get detached(): boolean { return this.state.newer !== null }

  /** A row the client painted before the host has it. */
  markLocal(id: string): void {
    this.local.add(id)
  }

  messages(): ChatMessage[] {
    if (this.materialized?.state !== this.state || this.materialized.folds !== this.folds) {
      this.materialized = { state: this.state, folds: this.folds,
        messages: this.state.messages.map((message) => materializeWindowMessage(this.withFolds(message))) }
    }
    return this.materialized.messages
  }

  /** Where the next page of a held fold starts; null when the window no longer holds it. */
  foldRequest(messageId: string, key: string): { revision: string; after?: string } | null {
    const fold = heldFold(this.state, messageId, key)
    if (!fold) return null
    const loaded = this.folds.get(messageId)?.get(key)
    const after = loaded?.revision === fold.revision ? loaded.fragments.at(-1)?.key : undefined
    return { revision: fold.revision, ...(after ? { after } : {}) }
  }

  /**
   * Join a fold page read after `after`. A page for a fold that changed, or
   * one a concurrent read already joined, is dropped.
   * @returns false when the window no longer holds that fold at that revision.
   */
  applyFoldPage(page: TranscriptFoldResult, after: string | undefined): boolean {
    const fold = heldFold(this.state, page.messageId, page.fold)
    if (!fold || fold.revision !== page.revision) return false
    const byKey = this.folds.get(page.messageId)
    const loaded = byKey?.get(page.fold)
    const current = loaded?.revision === page.revision ? loaded : undefined
    if ((current?.fragments.at(-1)?.key) !== after) return true
    const expansion: FoldExpansion = { revision: page.revision, fragments: [...current?.fragments ?? [], ...page.fragments], rest: page.rest }
    this.setFolds(page.messageId, new Map(byKey).set(page.fold, expansion))
    return true
  }

  /**
   * Window rows in order (as given, or as materialized), with the client's own
   * rows the window does not hold yet. Each stays after the window row it
   * followed, so a send that failed keeps its place as later turns arrive;
   * one whose predecessor left the window goes last.
   */
  reconcile(current: readonly ChatMessage[], windowed: ChatMessage[] = this.messages()): ChatMessage[] {
    const ids = new Set(windowed.map((message) => message.id))
    for (const id of this.local) if (ids.has(id)) this.local.delete(id)
    if (!this.local.size) return windowed
    const after = new Map<string | null, ChatMessage[]>()
    let anchor: string | null = null
    for (const message of current) {
      if (this.local.has(message.id)) after.set(anchor, [...after.get(anchor) ?? [], message])
      else if (ids.has(message.id)) anchor = message.id
    }
    if (!after.size) return windowed
    return [...windowed.flatMap((message) => [message, ...after.get(message.id) ?? []]), ...after.get(null) ?? []]
  }

  /** @returns false when the patch referred to content this window cannot rebuild. */
  applyPatch(patch: TranscriptWindowPatch): boolean {
    const { state, stale } = applyWindowPatch(this.state, patch, windowLookup(this.state))
    this.adopt(state)
    return !stale
  }

  /** @returns ids of messages whose bodies were neither sent nor held. */
  applyResult(result: TranscriptWindowResult, placement: 'replace' | 'older' | 'newer'): string[] {
    const { state, missing } = applyWindowResult(this.state, result, windowLookup(this.state), placement)
    if (!missing.length) this.adopt(state)
    return missing
  }

  /**
   * Install a window that was merged outside this sync. Fold pages whose
   * revision still matches stay loaded, including when the read replaces the
   * held rows.
   */
  replace(state: TranscriptWindowState): void {
    this.adopt(state)
  }

  /**
   * Take a new held window. A fold that replaces fragments this client held
   * (a reply that settled while shown) keeps them as its loaded pages when
   * they hash to its revision; loaded pages of folds no longer held go.
   */
  private adopt(state: TranscriptWindowState): void {
    const previous = new Map(this.state.messages.map((message) => [message.id, message]))
    this.state = state
    let changed = false
    const next = new Map<string, ReadonlyMap<string, FoldExpansion>>()
    for (const message of state.messages) {
      const kept = this.folds.get(message.id)
      let byKey: Map<string, FoldExpansion> | undefined
      for (const fragment of message.fragments) {
        if (fragment.body.kind !== 'fold') continue
        const loaded = kept?.get(fragment.key)
        const expansion = loaded?.revision === fragment.body.revision ? loaded : seededFold(previous.get(message.id), fragment)
        if (expansion) (byKey ??= new Map()).set(fragment.key, expansion)
      }
      const same = byKey && kept && byKey.size === kept.size && [...byKey].every(([key, value]) => kept.get(key) === value)
      if (same) next.set(message.id, kept)
      else if (byKey) next.set(message.id, byKey)
      if (!same && (byKey || kept)) changed = true
    }
    if (changed || next.size !== this.folds.size) this.folds = next
  }

  private setFolds(messageId: string, byKey: ReadonlyMap<string, FoldExpansion>): void {
    this.folds = new Map(this.folds).set(messageId, byKey)
  }

  /** The held message with each loaded fold spliced in: its pages, then the fold past them. */
  private withFolds(message: WindowStoreMessage): WindowStoreMessage {
    const byKey = this.folds.get(message.id)
    if (!byKey) return message
    const memo = this.spliced.get(message)
    if (memo?.folds === byKey) return memo.message
    const fragments = message.fragments.flatMap((fragment): WindowStoreFragment[] => {
      const loaded = fragment.body.kind === 'fold' ? byKey.get(fragment.key) : undefined
      if (!loaded || fragment.body.kind !== 'fold' || loaded.revision !== fragment.body.revision) return [fragment]
      const last = loaded.fragments.at(-1)
      return loaded.rest && last
        ? [...loaded.fragments, { ...fragment, body: { ...fragment.body, summary: loaded.rest }, after: last.key }]
        : loaded.fragments
    })
    const spliced = { ...message, fragments }
    this.spliced.set(message, { folds: byKey, message: spliced })
    return spliced
  }
}

function heldFold(state: TranscriptWindowState, messageId: string, key: string): { revision: string } | null {
  const body = state.messages.find((message) => message.id === messageId)?.fragments.find((fragment) => fragment.key === key)?.body
  return body?.kind === 'fold' ? { revision: body.revision } : null
}

/** A new fold over fragments `previous` held whole: they are its pages, if they still hash to it. */
function seededFold(previous: WindowStoreMessage | undefined, fold: WindowStoreFragment): FoldExpansion | undefined {
  if (!previous || fold.body.kind !== 'fold') return undefined
  const start = previous.fragments.findIndex((fragment) => fragment.key === fold.key.slice(FOLD_KEY_PREFIX.length))
  if (start < 0) return undefined
  const fragments = previous.fragments.slice(start, start + fold.body.summary.fragments)
  if (fragments.length !== fold.body.summary.fragments || fragments.some((fragment) => fragment.body.kind === 'fold')) return undefined
  return foldRevision(fragments) === fold.body.revision ? { revision: fold.body.revision, fragments, rest: null } : undefined
}

/**
 * What a phone keeps of a window: the newest fragments of `state` under the
 * cache ceiling. Measuring stringifies
 * bodies, so a deferred write trims the state it captured, not the open window.
 */
export function cacheableWindow(state: TranscriptWindowState): TranscriptWindowState {
  return trimWindowState(state, WINDOW_CACHE_BYTES)
}
