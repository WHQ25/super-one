import type { AgentEvent } from '@superone/shared/agent-types'
import log from '../logger'

/**
 * Where an event entered the desktop. Consumers subscribe by source, so the
 * routing of every event in main reads from one table instead of from the
 * call sites that used to send it.
 */
export type HubSource =
  /** A local `Session`, through `SessionManager.onAny`. */
  | 'session'
  /** Environment state with no session: provider and additional-directory changes. */
  | 'environment'
  | 'draft'
  /** Session and project list invalidations. */
  | 'list'
  /** Phone presence on a session. */
  | 'presence'
  /** A settings patch for a session this process does not hold. */
  | 'settings'
  /** A session on a remote node, mapped from its event log. */
  | 'remote-node'
  /** A change this host made to a remote-node session (an MCP App state update). */
  | 'remote-update'

export interface HubEvent {
  readonly event: AgentEvent
  readonly source: HubSource
  /** Set for `session` events: the emitting session. */
  readonly sessionId?: string
  /** A newly registered session's replay of its known state. */
  readonly replay?: boolean
}

export interface HubConsumer {
  readonly name: string
  readonly sources: readonly HubSource[]
  /** Whether replay events reach this consumer. */
  readonly replay: boolean
  deliver(event: HubEvent): void
}

export class SessionEventHub {
  private readonly consumers: HubConsumer[] = []

  subscribe(consumer: HubConsumer): () => void {
    this.consumers.push(consumer)
    return () => {
      const index = this.consumers.indexOf(consumer)
      if (index >= 0) this.consumers.splice(index, 1)
    }
  }

  publish(event: HubEvent): void {
    for (const consumer of [...this.consumers]) {
      if (!consumer.sources.includes(event.source)) continue
      if (event.replay && !consumer.replay) continue
      try {
        consumer.deliver(event)
      } catch (err) {
        log.warn('[SessionEventHub] consumer %s failed on %s: %s', consumer.name, event.event.type, err instanceof Error ? err.message : String(err))
      }
    }
  }
}
