import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { DeliveryPolicy } from '../delivery-policy'
import type { EventBatcherOptions } from '../event-batcher'
import { EventProfile, type ProfilePorts } from './profile'
import { DetailViews, projectProgressiveEvent, projectProgressiveMessage } from './projection'
import { stripMessagesForRemote } from './remote-content'

/**
 * Everything one frontend connection receives from a session, under its
 * delivery policy: live events, opened and paged transcripts, and expanded
 * detail. Its projection, detail and throttle state are its own, so two
 * connections on one session never share them.
 */
export class ConnectionDelivery {
  /** Sessions this connection opened summarized, and the rows it expanded. */
  readonly views = new DetailViews()
  private readonly profile: EventProfile

  constructor(private current: DeliveryPolicy, ports?: ProfilePorts) {
    this.profile = new EventProfile(current, ports)
  }

  get policy(): DeliveryPolicy {
    return this.current
  }

  /** On failover; the next delivery uses the new tier. */
  setPolicy(policy: DeliveryPolicy): void {
    this.current = policy
    this.profile.setPolicy(policy)
  }

  /**
   * A session's live event: summarized when this connection opened the
   * session summarized, then shaped for the connection, followed by the
   * detail packets the event changed. `messages` is the session's reduced
   * transcript including this event.
   */
  live(event: AgentEvent, sessionId: string, messages: readonly ChatMessage[]): AgentEvent[] {
    return [...this.event(event, sessionId, messages), ...this.details(sessionId, messages)]
  }

  /** The event itself: summarized when the session is, then shaped. */
  event(event: AgentEvent, sessionId: string, messages: readonly ChatMessage[]): AgentEvent[] {
    if (!this.views.has(sessionId)) return this.shape(event)
    const projected = projectProgressiveEvent(event, messages)
    return projected ? this.shape(projected) : []
  }

  /** The detail packets for the rows this connection expanded that `messages` changed. */
  details(sessionId: string, messages: readonly ChatMessage[]): AgentEvent[] {
    return this.views.updates(sessionId, messages).flatMap((update) => this.shape(update))
  }

  /** An event outside a session's projection (replays, notices, list changes). */
  shape(event: AgentEvent): AgentEvent[] {
    return this.profile.apply(event)
  }

  /** Transcript rows for an open or a history page. */
  messages(messages: readonly ChatMessage[], sessionId: string, projectPath?: string): ChatMessage[] {
    const rows = this.views.has(sessionId) ? messages.map(projectProgressiveMessage) : [...messages]
    return this.current.surface === 'phone' ? stripMessagesForRemote(rows, projectPath) : rows
  }
}

/** Batching a connection's frames: up to one relay frame's budget off the local link. */
export function batchingFor(policy: DeliveryPolicy): EventBatcherOptions {
  return policy.tier === 'local' ? {} : { maxBytes: 64 * 1024, maxEvents: 128 }
}
