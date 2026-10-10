import type { AgentEvent, TerminalEvent } from '@superone/shared/agent-types'
import { parseRemoteProjectKey, parseRemoteTerminalKey } from '@superone/shared/remote-resource-key'
import type { TopicRef } from '@superone/shared/environment/topics'
import { TopicHub, type DeliveryPolicy } from '@superone/runtime/stream'
import type { HubEvent, HubSource } from './session-event-hub'
import log from '../logger'
import type { Session } from '../session/types'
import { sessionActivityEvent } from '../remote/mobile-broadcaster'
import type { LocalTopicRecovery } from './topic-recovery'

/**
 * The desktop backend's topics: every event leaving main is published to the
 * one topic it belongs to, and each frontend connection (the renderer, each
 * phone) receives the topics it subscribed to. In-process consumers that keep
 * their own state (bookkeeping, automations, collaboration, notifications)
 * stay on `SessionEventHub` sources.
 */
export type DesktopTopicItem =
  | { kind: 'agent'; event: AgentEvent; source?: HubSource; replay?: boolean }
  | { kind: 'terminal'; event: TerminalEvent }

export type DesktopTopicHub = TopicHub<DesktopTopicItem, DeliveryPolicy>

export function createDesktopTopicHub(): DesktopTopicHub {
  return new TopicHub<DesktopTopicItem, DeliveryPolicy>({
    onSinkError: (id, topic, err) => log.warn('[topics] %s failed on %s: %s', id, topic.kind, err instanceof Error ? err.message : String(err)),
  })
}

/**
 * The environment an event is about: a remote session's events carry its
 * machine in the project key (`remote:<connectionId>:<path>`).
 */
function environmentOf(event: AgentEvent, localEnvironmentId: string): string {
  return (event.projectPath && parseRemoteProjectKey(event.projectPath)?.connectionId) || localEnvironmentId
}

/** The one topic a hub event is published to. */
export function topicOfHubEvent({ event, source }: HubEvent, localEnvironmentId: string): TopicRef {
  if (source === 'list') {
    return event.type === 'project_list_changed'
      ? { kind: 'projects', environmentId: localEnvironmentId }
      : { kind: 'sessionList', environmentId: localEnvironmentId }
  }
  if (source === 'draft') return { kind: 'drafts', environmentId: localEnvironmentId }
  const environmentId = environmentOf(event, localEnvironmentId)
  return event.sessionId
    ? { kind: 'session', environmentId, sessionId: event.sessionId }
    : { kind: 'environment', environmentId }
}

/** List metadata goes to every viewer of the list; the rest to the terminal's viewers. */
const TERMINAL_LIST_EVENTS = new Set<TerminalEvent['type']>([
  'terminal_title_changed', 'terminal_created', 'terminal_exited', 'terminal_control_changed',
])

/** A remote terminal's id here is its key (`remote-terminal:<connectionId>:<id>`). */
export function topicOfTerminalEvent(event: TerminalEvent, localEnvironmentId: string): TopicRef | null {
  if (!('terminalId' in event) || !event.terminalId) return null
  const remote = parseRemoteTerminalKey(event.terminalId)
  const environmentId = remote?.connectionId ?? localEnvironmentId
  if (TERMINAL_LIST_EVENTS.has(event.type)) return { kind: 'terminalList', environmentId }
  return { kind: 'terminal', environmentId, terminalId: remote?.terminalId ?? event.terminalId }
}

export interface HubEventPublishContext {
  localEnvironmentId: string
  /** Versions list and draft changes for readers that resume. */
  recovery?: LocalTopicRecovery
  getSession(sessionId: string): Session | null | undefined
  spawnParentOf(sessionId: string): string | null
}

/**
 * Publish one hub event to its topic. A local session's event first updates
 * that session's sidebar summary on the session list.
 */
export function publishHubEvent(topics: DesktopTopicHub, hubEvent: HubEvent, context: HubEventPublishContext): void {
  const { localEnvironmentId } = context
  const session = hubEvent.source === 'session' && hubEvent.sessionId ? context.getSession(hubEvent.sessionId) : null
  const activity = session ? sessionActivityEvent(session, hubEvent.event, context.spawnParentOf(session.id)) : null
  if (activity) publish(topics, { kind: 'sessionList', environmentId: localEnvironmentId }, activity, 'session', context)
  publish(topics, topicOfHubEvent(hubEvent, localEnvironmentId), hubEvent.event, hubEvent.source, context, hubEvent.replay)
}

function publish(topics: DesktopTopicHub, topic: TopicRef, event: AgentEvent, source: HubSource, context: HubEventPublishContext, replay?: boolean): void {
  if (!replay) context.recovery?.record(topic, event)
  topics.publish(topic, { kind: 'agent', event, source, ...(replay ? { replay } : {}) })
}
