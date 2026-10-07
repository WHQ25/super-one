import type { DraftChangedEvent } from '@superone/shared/environment/draft-rpc'

export const RELAY_DRAFT_SAVE_INTERVAL_MS = 5_000

export interface DraftRecipients { lan: string[]; relay: string[] }

/**
 * A desktop composer autosaves on every typing pause, and each save reaches the
 * phones as `draft_changed`. LAN phones get every save; relay phones get the
 * latest save per draft at most once per interval. Their rows only need to catch
 * up, because `open_draft` flushes the desktop editor and returns live content.
 * Lease and delete changes carry the newest draft, so they go out at once and
 * replace any save still waiting.
 */
export class RelayDraftSaveThrottle {
  private pending = new Map<string, { event: DraftChangedEvent; targets?: string[]; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private readonly send: (event: DraftChangedEvent, targets?: string[]) => void,
    private readonly recipients: (targets?: string[]) => DraftRecipients,
  ) {}

  route(event: DraftChangedEvent, targets?: string[]): void {
    if (event.reason !== 'saved') {
      this.cancel(event.draftId)
      this.send(event, targets)
      return
    }
    const { lan, relay } = this.recipients(targets)
    if (lan.length) this.send(event, lan)
    if (!relay.length) return
    const queued = this.pending.get(event.draftId)
    if (queued) {
      queued.event = event
      queued.targets = targets
      return
    }
    const timer = setTimeout(() => {
      const latest = this.pending.get(event.draftId)
      this.pending.delete(event.draftId)
      if (!latest) return
      const { relay: now } = this.recipients(latest.targets)
      if (now.length) this.send(latest.event, now)
    }, RELAY_DRAFT_SAVE_INTERVAL_MS)
    this.pending.set(event.draftId, { event, targets, timer })
  }

  dispose(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }

  private cancel(draftId: string): void {
    clearTimeout(this.pending.get(draftId)?.timer)
    this.pending.delete(draftId)
  }
}
