import type { SessionInboxItem } from '@superone/shared/session-inbox'
import type { OpenCodeV2Client } from './opencode-v2-client'

/** Only pending user input is controllable; native compaction/move stay upstream. */
export class OpenCodeInbox {
  items: SessionInboxItem[] = []
  private read: Promise<SessionInboxItem[]> | undefined
  private dirty = false
  constructor(private readonly client: Pick<OpenCodeV2Client, 'inbox' | 'cancelInbox' | 'updateInbox'>,
    private readonly sessionID: string, private readonly signal: AbortSignal,
    private readonly publish: (items: SessionInboxItem[]) => void) {}

  refresh(): Promise<SessionInboxItem[]> {
    if (this.read) { this.dirty = true; return this.read }
    this.dirty = false
    this.read = this.client.inbox(this.sessionID, this.signal).then((native) => {
      this.signal.throwIfAborted()
      this.items = native.filter((item) => item.type === 'user').map((item) => ({
        id: item.id, text: item.payload.text, delivery: item.delivery,
        createdAt: item.time.created, attachmentCount: item.payload.files?.length ?? 0,
        ...(typeof item.payload.metadata?.superoneClientMessageId === 'string'
          ? { clientMessageId: item.payload.metadata.superoneClientMessageId } : {}),
      }))
      this.publish(this.items)
      return this.items
    }).finally(() => {
      this.read = undefined
      if (this.dirty && !this.signal.aborted) void this.refresh().catch(() => {})
    })
    return this.read
  }

  private async pending(id: string) {
    const native = await this.client.inbox(this.sessionID, this.signal)
    this.signal.throwIfAborted()
    if (!native.some((item) => item.id === id && item.type === 'user')) throw new Error('This input is no longer pending')
  }
  async cancel(id: string, assertControl: () => void) {
    await this.pending(id)
    await this.client.cancelInbox(this.sessionID, id, () => { this.signal.throwIfAborted(); assertControl() })
    await this.refresh()
  }
  async update(id: string, delivery: 'steer' | 'queue', assertControl: () => void) {
    await this.pending(id)
    await this.client.updateInbox(this.sessionID, id, delivery, () => { this.signal.throwIfAborted(); assertControl() })
    await this.refresh()
  }
}
