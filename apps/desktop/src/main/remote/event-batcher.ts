import type { AgentEvent } from '@superone/shared/agent-types'
import { coalesceAgentEventBatch } from '@superone/shared/agent-event-batcher'

/** Ordered recipient groups; only adjacent, safely additive events are folded. */
export class RemoteEventBatcher {
  private events: AgentEvent[] = []
  private targets: string[] | undefined
  private targetKey = ''
  private bytes = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private send: (events: AgentEvent[], targets?: string[]) => void) {}

  push(event: AgentEvent, targets?: string[]): void {
    const normalized = targets?.length ? [...new Set(targets)].sort() : undefined
    const key = JSON.stringify(normalized) ?? '*'
    const bytes = new TextEncoder().encode(JSON.stringify(event)).length
    if (this.events.length && (key !== this.targetKey || this.bytes + bytes > 64 * 1024 || this.events.length >= 128)) this.flush()
    this.targetKey = key
    this.targets = normalized
    this.events.push(event)
    this.bytes += bytes
    if ((event.type !== 'content_delta' && event.type !== 'codex_item_delta') || this.bytes >= 64 * 1024) this.flush()
    else this.timer ??= setTimeout(() => this.flush(), 33)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const events = this.events
    this.events = []
    this.bytes = 0
    if (events.length) this.send(coalesceAgentEventBatch(events), this.targets)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.events = []
    this.bytes = 0
  }
}
