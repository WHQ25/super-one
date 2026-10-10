import type { EnvironmentEventEnvelope } from './events'
import { SESSION_DURABLE_EVENT } from './session-events'

/**
 * What a frontend subscribes to on a backend: one scoped resource whose
 * changes the backend publishes. A connection receives only the topics it
 * subscribed to (docs/architecture/remote-node-service.md §9).
 *
 * - `session`: one session's event stream. `sessionId: '*'` follows every
 *   session of the environment (a controller desktop's aggregate feed).
 * - `sessionList`: session list invalidations and sidebar activity, all projects.
 * - `projects`: the environment's project list.
 * - `drafts`: composer drafts.
 * - `terminal`: one terminal's output and state. `terminalId: '*'` follows
 *   every terminal of the environment.
 * - `terminalList`: terminal list metadata (created, title, exit, agent control).
 * - `environment`: environment-wide notices with no other home (provider and
 *   workspace-directory changes).
 */
export type TopicRef =
  | { kind: 'session'; environmentId: string; sessionId: string }
  | { kind: 'sessionList'; environmentId: string }
  | { kind: 'projects'; environmentId: string }
  | { kind: 'drafts'; environmentId: string }
  | { kind: 'terminal'; environmentId: string; terminalId: string }
  | { kind: 'terminalList'; environmentId: string }
  | { kind: 'environment'; environmentId: string }

export type TopicKind = TopicRef['kind']

/** As an instance id, subscribes a connection to every instance of its kind (`session` or `terminal`). */
export const TOPIC_WILDCARD = '*'

export const TOPIC_KINDS: readonly TopicKind[] = ['session', 'sessionList', 'projects', 'drafts', 'terminal', 'terminalList', 'environment']

function instanceOf(ref: TopicRef): string {
  if (ref.kind === 'session') return ref.sessionId
  if (ref.kind === 'terminal') return ref.terminalId
  return ''
}

/** Stable map key: `kind:environmentId[:instance]`. */
export function topicKey(ref: TopicRef): string {
  const instance = instanceOf(ref)
  return instance ? `${ref.kind}:${ref.environmentId}:${instance}` : `${ref.kind}:${ref.environmentId}`
}

/** The wildcard key a published ref also reaches, or null for kinds without instances. */
export function topicWildcardKey(ref: TopicRef): string | null {
  if (ref.kind !== 'session' && ref.kind !== 'terminal') return null
  return `${ref.kind}:${ref.environmentId}:${TOPIC_WILDCARD}`
}

export function isTopicWildcard(ref: TopicRef): boolean {
  return instanceOf(ref) === TOPIC_WILDCARD
}

export function sameTopic(a: TopicRef, b: TopicRef): boolean {
  return topicKey(a) === topicKey(b)
}

/** A wire-supplied topic, or null when malformed. */
export function readTopicRef(value: unknown): TopicRef | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const environmentId = typeof v.environmentId === 'string' && v.environmentId ? v.environmentId : null
  if (!environmentId) return null
  switch (v.kind) {
    case 'session':
      return typeof v.sessionId === 'string' && v.sessionId ? { kind: 'session', environmentId, sessionId: v.sessionId } : null
    case 'terminal':
      return typeof v.terminalId === 'string' && v.terminalId ? { kind: 'terminal', environmentId, terminalId: v.terminalId } : null
    case 'sessionList':
    case 'projects':
    case 'drafts':
    case 'terminalList':
    case 'environment':
      return { kind: v.kind, environmentId }
    default:
      return null
  }
}

/**
 * The topic an environment event log entry belongs to. Session lifecycle
 * rows also reach the session list; terminal rows reach their terminal.
 */
/** Session events that change the session list: they also belong to the `sessionList` topic. */
export const SESSION_LIST_EVENT_TYPES: ReadonlySet<string> = new Set([
  SESSION_DURABLE_EVENT.created,
  SESSION_DURABLE_EVENT.renamed,
  SESSION_DURABLE_EVENT.uiFlags,
  SESSION_DURABLE_EVENT.tagsChanged,
  SESSION_DURABLE_EVENT.closed,
  SESSION_DURABLE_EVENT.removed,
])

export function topicsOfEnvelope(envelope: EnvironmentEventEnvelope): TopicRef[] {
  const environmentId = envelope.environmentId
  switch (envelope.aggregateType) {
    case 'session':
      return SESSION_LIST_EVENT_TYPES.has(envelope.eventType)
        ? [{ kind: 'session', environmentId, sessionId: envelope.aggregateId }, { kind: 'sessionList', environmentId }]
        : [{ kind: 'session', environmentId, sessionId: envelope.aggregateId }]
    case 'interaction':
      return [{ kind: 'session', environmentId, sessionId: envelope.aggregateId }]
    case 'terminal':
      return [{ kind: 'terminal', environmentId, terminalId: envelope.aggregateId }]
    case 'project':
      return [{ kind: 'projects', environmentId }]
    default:
      return [{ kind: 'environment', environmentId }]
  }
}

/**
 * Where a reader stands on a versioned topic (session list, projects, drafts):
 * change events carry increasing versions within an epoch.
 */
export interface TopicVersionCursor {
  epoch: string
  version: number
}

/**
 * How a subscribe resumes a topic: the change events after the cursor, or a
 * signal to read the topic's snapshot again because some are gone.
 */
export type TopicRecovery<T> =
  | { kind: 'replay'; items: T[]; cursor: TopicVersionCursor }
  | { kind: 'resnapshot'; cursor: TopicVersionCursor }
