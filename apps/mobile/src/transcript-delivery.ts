import type { HostInbound, ReductionProjection } from '@superone/chat-view'
import type { ChatMessage } from '@superone/shared/agent-types'
import { randomId } from './ids'
import { TranscriptProjection } from './transcript-projection'

export type TranscriptSnapshot = Omit<ReductionProjection, 'delivery' | 'messagePatches' | 'messageOrder'> & { messages: ChatMessage[] }
export const TRANSCRIPT_RETRY_MS = 1000

/** One unacknowledged paint and one latest snapshot, regardless of stream speed. */
export class TranscriptDelivery {
  private readonly channelId = randomId()
  private sequence = 0
  private projection = new TranscriptProjection()
  private inFlight: HostInbound | null = null
  private pending: TranscriptSnapshot | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  constructor(private readonly send: (message: HostInbound) => void) {}

  publish(snapshot: TranscriptSnapshot, hydrate = false): void {
    if (hydrate || !this.initialized) {
      this.dispose()
      this.projection = new TranscriptProjection()
      this.initialized = true
      this.dispatch(snapshot, true)
    } else if (this.inFlight) {
      // Retain optional artwork updates while replacing growing rows and scalar facts.
      this.pending = { ...this.pending, ...snapshot }
    } else {
      this.dispatch(snapshot, false)
    }
  }

  acknowledge(channelId: string, sequence: number): void {
    if (channelId !== this.channelId || sequence !== this.sequence || !this.inFlight) return
    this.clearTimer()
    this.inFlight = null
    const pending = this.pending
    this.pending = null
    if (pending) this.dispatch(pending, false)
  }

  dispose(): void {
    this.clearTimer()
    this.inFlight = null
    this.pending = null
    this.initialized = false
  }

  private dispatch(snapshot: TranscriptSnapshot, hydrate: boolean): void {
    const { messages, ...facts } = snapshot
    this.inFlight = {
      type: hydrate ? 'hydrate' : 'applyReductionPatch',
      ...facts,
      ...this.projection.project(messages, hydrate),
      delivery: { channelId: this.channelId, sequence: ++this.sequence },
    }
    this.transmit()
  }

  private transmit(): void {
    if (!this.inFlight) return
    // Arm before send so a synchronous receipt can cancel the timer too.
    this.timer = setTimeout(() => { this.timer = null; this.transmit() }, TRANSCRIPT_RETRY_MS)
    try { this.send(this.inFlight) } catch {
      // Native injection can fail while a WebView is being replaced. Keep the retry armed.
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
