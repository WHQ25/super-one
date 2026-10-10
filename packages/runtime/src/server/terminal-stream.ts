import type { TerminalEvent } from '@superone/shared/agent-types'
import { TOPIC_WILDCARD, type TopicRef } from '@superone/shared/environment/topics'
import type { EventStreamHandle } from './event-stream'

/** Events that change a terminal's row in the list, besides belonging to the terminal itself. */
const LIST_EVENTS: ReadonlySet<TerminalEvent['type']> = new Set([
  'terminal_created', 'terminal_exited', 'terminal_title_changed', 'terminal_control_changed',
])

/** A host's terminal events as a stream follows them (`TerminalsPort.onEvent`). */
export interface TerminalEventSource {
  onEvent(listener: (event: TerminalEvent) => void): () => void
}

/**
 * The terminal topics of one stream: each event of a followed terminal, and
 * list changes while it follows `terminalList`. Output is ordered by its
 * sequence; a reader resumes from `terminal.attach` (snapshot plus the
 * sequence it covers) and applies output above that sequence.
 */
export function openTerminalStream(opts: {
  source: TerminalEventSource
  environmentId: string
  topics: readonly TopicRef[]
  push: (event: TerminalEvent) => void
}): EventStreamHandle {
  let terminals = new Set<string>()
  let list = false
  const setTopics = (topics: readonly TopicRef[]) => {
    terminals = new Set()
    list = false
    for (const topic of topics) {
      if (topic.environmentId !== opts.environmentId) continue
      if (topic.kind === 'terminal') terminals.add(topic.terminalId)
      if (topic.kind === 'terminalList') list = true
    }
  }
  setTopics(opts.topics)
  const off = opts.source.onEvent((event) => {
    const terminalId = 'terminalId' in event ? event.terminalId : undefined
    if (!terminalId) return
    const followed = terminals.has(terminalId) || terminals.has(TOPIC_WILDCARD)
    if (followed || (list && LIST_EVENTS.has(event.type))) opts.push(event)
  })
  return { setTopics, close: off }
}

/** One handle over a stream's parts: topic changes and close reach each. */
export function combineStreams(...parts: Array<EventStreamHandle | null>): EventStreamHandle {
  const live = parts.filter((part): part is EventStreamHandle => part !== null)
  return {
    setTopics: (topics) => { for (const part of live) part.setTopics(topics) },
    close: () => { for (const part of live) part.close() },
  }
}
