import type { ChatMessage } from '@superone/shared/agent-types'
import type { TranscriptWindowPatch, TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import {
  applyWindowPatch,
  applyWindowResult,
  materializeWindowMessage,
  trimWindowState,
  windowLookup,
  type TranscriptWindowState,
} from '@superone/shared/transcript-window/window-store'

/** A cached window per session; the blob pool's LRU bounds the total. */
export const WINDOW_CACHE_BYTES = 2 * 1024 * 1024

/**
 * The transcript window a phone holds for its open session. The window is the
 * only source of transcript content: `reconcile` rebuilds the session's
 * messages from it after the reducer ran, keeping only rows the phone made
 * itself (an optimistic bubble, a send the host never took) until the window
 * carries them.
 */
export class TranscriptWindowSync {
  private local = new Set<string>()
  private materialized: { state: TranscriptWindowState; messages: ChatMessage[] } | null = null

  constructor(private state: TranscriptWindowState) {}

  get current(): TranscriptWindowState { return this.state }
  get hasOlder(): boolean { return this.state.older !== null }
  get detached(): boolean { return this.state.newer !== null }

  /** A row the phone painted before the host has it. */
  markLocal(id: string): void {
    this.local.add(id)
  }

  messages(): ChatMessage[] {
    if (this.materialized?.state !== this.state) {
      this.materialized = { state: this.state, messages: this.state.messages.map(materializeWindowMessage) }
    }
    return this.materialized.messages
  }

  /**
   * Window rows in order (as given, or as materialized), with the phone's own
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
    this.state = state
    return !stale
  }

  /** @returns ids of messages whose bodies were neither sent nor held. */
  applyResult(result: TranscriptWindowResult, placement: 'replace' | 'older' | 'newer'): string[] {
    const { state, missing } = applyWindowResult(this.state, result, windowLookup(this.state), placement)
    if (!missing.length) this.state = state
    return missing
  }

  /** What to keep on the phone: the newest fragments under the cache ceiling. */
  cacheable(): TranscriptWindowState {
    return trimWindowState(this.state, WINDOW_CACHE_BYTES)
  }
}
