import { phoneDelivery } from './phone-deliveries'
import { takeAttachmentOrigin, withoutAttachmentBytes } from './attachment-echo'
import { SESSION_ACTIVITY_EVENTS } from '@superone/shared/session-activity'
import { withoutDraftAttachmentBytes } from '@superone/shared/environment/draft-content'
import type { AgentEvent, ChatMessage, TerminalEvent } from '@superone/shared/agent-types'
import type { TopicRef } from '@superone/shared/environment/topics'
import type { TopicGroup } from '@superone/runtime/stream'
import type { Session, SessionManager } from '../session/types'
import type { DesktopTopicItem } from '../stream/desktop-topics'
import type { HubSource } from '../stream/session-event-hub'
import { trace } from '../agent/event-trace'
import { liveSessionActivity } from './live-session-activity'
import log from '../logger'

export interface MobileTransport {
  sendAgentEvent(event: AgentEvent, targetDeviceIds?: string[]): Promise<void>
  /** Events already shaped for one phone. */
  sendDeviceEvents(deviceId: string, events: AgentEvent[]): void
}

export interface PhoneTerminalTransport {
  deliver(event: TerminalEvent, deviceIds: readonly string[]): void
}

/**
 * Sources a phone renders. Presence reaches phones as its own notices
 * (`PresenceCoordinator`), settings fallbacks and remote-node events are
 * desktop-window state, and routed node sessions have their own stream.
 */
const PHONE_SOURCES = new Set<HubSource>(['session', 'environment', 'draft', 'list', 'remote-update'])

/**
 * Prompts are rare and block the agent until answered, so their routing goes to
 * main.log too: `trace` is dev-only, and "the phone never showed the prompt"
 * reports come from release builds.
 */
function logInteractionRoute(event: AgentEvent, outcome: string, detail: Record<string, unknown>): void {
  if (event.type !== 'permission_request' && event.type !== 'ask_user_question' && event.type !== 'plan_approval') return
  log.info('[MobileBroadcaster] %s %s requestId=%s sessionId=%s %o', event.type, outcome, event.request.requestId, event.sessionId, detail)
}

/**
 * The sidebar summary a session event changes, for every phone's session
 * list (`sessionList` topic); null when the event leaves the summary alone.
 */
export function sessionActivityEvent(session: Session, event: AgentEvent, parentSessionId: string | null): AgentEvent | null {
  if (session.ephemeral || !SESSION_ACTIVITY_EVENTS.has(event.type)) return null
  return {
    type: 'session_activity',
    activity: liveSessionActivity(session, parentSessionId),
    ...(event.type === 'status_change' && event.status === 'idle' ? { completed: true } : {}),
  }
}

/**
 * The phones' delivery group: the topic hub hands it each item once with the
 * phones it reaches. List, draft and environment topics go to every phone; a
 * session's events go to the phones following it, summarized for progressive
 * ones (docs/architecture/mobile-remote-control.md).
 */
export class MobileBroadcaster implements TopicGroup<DesktopTopicItem> {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly transport: MobileTransport,
    /** Stamped on session events, so a phone can tell this desktop's sessions from routed ones. */
    private readonly localEnvironmentId: string,
    private readonly terminals?: PhoneTerminalTransport,
  ) {}

  deliver(topic: TopicRef, item: DesktopTopicItem, deviceIds: readonly string[]): void {
    if (item.kind === 'terminal') {
      this.terminals?.deliver(item.event, deviceIds)
      return
    }
    if (item.source && !PHONE_SOURCES.has(item.source)) return
    const event = item.event
    if (topic.kind === 'session') {
      // Routed node sessions reach phones on their own stream.
      if (topic.environmentId === this.localEnvironmentId) void this.deliverSession(event, deviceIds)
      return
    }
    void this.transport.sendAgentEvent(
      event.type === 'draft_changed' && event.draft ? { ...event, draft: withoutDraftAttachmentBytes(event.draft) } : event,
    )
  }

  /** A local session's event, to the phones following the session. */
  async deliverSession(event: AgentEvent, deviceIds: readonly string[]): Promise<void> {
    const session = event.sessionId ? this.sessionManager.getSession(event.sessionId) : null
    if (!session) {
      trace('remote.broadcast', 'drop:no-session', { type: event.type, sessionId: event.sessionId })
      logInteractionRoute(event, 'drop:no-session', {})
      return
    }
    const targets = new Set(deviceIds)
    if (targets.size === 0) {
      trace('remote.broadcast', 'drop:no-target', { type: event.type, sessionId: event.sessionId, owner: session.owner.kind })
      logInteractionRoute(event, 'drop:no-target', { owner: session.owner.kind })
      return
    }
    const messages = session.snapshot.messages
    event = { ...event, environmentId: this.localEnvironmentId }
    trace('remote.broadcast', 'route', { type: event.type, sessionId: event.sessionId, targets: [...targets] })
    logInteractionRoute(event, 'route', { targets: [...targets] })
    // The sender of a message with attachments gets the echo without the bytes.
    const origin = event.type === 'user_message_appended' && event.message.attachments?.length
      ? takeAttachmentOrigin(event.message.id)
      : undefined
    if (origin && targets.has(origin)) {
      targets.delete(origin)
      this.send(withoutAttachmentBytes(event), [origin], session, messages)
    }
    this.send(event, [...targets], session, messages)
  }

  /** Each phone gets the event under its own delivery: summarized if it opened the session so. */
  private send(event: AgentEvent, targets: string[], session: Session, messages: readonly ChatMessage[]): void {
    for (const deviceId of targets) this.transport.sendDeviceEvents(deviceId, phoneDelivery(deviceId).live(event, session.id, messages))
  }
}
