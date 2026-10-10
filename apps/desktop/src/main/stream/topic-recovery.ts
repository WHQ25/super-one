import type { AgentEvent } from '@superone/shared/agent-types'
import type { TopicRecovery, TopicRef, TopicVersionCursor } from '@superone/shared/environment/topics'
import { VersionedTopicLog } from '@superone/runtime/stream'

type VersionedKind = 'sessionList' | 'projects' | 'drafts'
const VERSIONED: ReadonlySet<string> = new Set<VersionedKind>(['sessionList', 'projects', 'drafts'])

/** Where a reader stands on a terminal: the last output sequence it applied. */
export interface TerminalCursor {
  sequence: number
}

export type TerminalRecovery =
  | { kind: 'replay'; sequence: number }
  | { kind: 'resnapshot'; sequence: number }

/**
 * How each local topic resumes after a reader was away. Session lists,
 * projects and drafts are snapshot plus versioned change events, recorded
 * from the change notices main already publishes (`session-list-watch.ts`,
 * draft control); a reader too far behind reads the snapshot again. A
 * terminal resumes from its output sequence; output it no longer holds is
 * recovered by the attach snapshot. Sessions keep their own cursor and
 * `resnapshot` (`openEventStream`).
 */
export class LocalTopicRecovery {
  private readonly logs = new Map<VersionedKind, VersionedTopicLog<AgentEvent>>()

  constructor(
    private readonly localEnvironmentId: string,
    private readonly terminalSequence: (terminalId: string) => number | null,
    capacity = 256,
  ) {
    for (const kind of VERSIONED as ReadonlySet<VersionedKind>) this.logs.set(kind, new VersionedTopicLog(capacity))
  }

  /** Records a published change; returns its version, or null for topics without one. */
  record(topic: TopicRef, event: AgentEvent): number | null {
    return this.logOf(topic)?.append(event) ?? null
  }

  cursor(topic: TopicRef): TopicVersionCursor | null {
    return this.logOf(topic)?.cursor() ?? null
  }

  /** The changes a reader at `from` missed, or `resnapshot` when some are gone. */
  recover(topic: TopicRef, from: TopicVersionCursor | null | undefined): TopicRecovery<AgentEvent> | null {
    return this.logOf(topic)?.since(from) ?? null
  }

  /** A terminal reader at `from` needs nothing, or the attach snapshot. */
  recoverTerminal(terminalId: string, from: TerminalCursor | null | undefined): TerminalRecovery | null {
    const sequence = this.terminalSequence(terminalId)
    if (sequence === null) return null
    return from && from.sequence === sequence ? { kind: 'replay', sequence } : { kind: 'resnapshot', sequence }
  }

  private logOf(topic: TopicRef): VersionedTopicLog<AgentEvent> | undefined {
    if (topic.environmentId !== this.localEnvironmentId || !VERSIONED.has(topic.kind)) return undefined
    return this.logs.get(topic.kind as VersionedKind)
  }
}
