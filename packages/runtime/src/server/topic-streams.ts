import type { TerminalEvent } from '@superone/shared/agent-types'
import type { DraftChangedEvent } from '@superone/shared/environment/draft-rpc'
import { withoutDraftAttachmentBytes } from '@superone/shared/environment/draft-content'
import { TOPIC_WILDCARD, type TopicRef } from '@superone/shared/environment/topics'
import type { EventStreamHandle } from './event-stream'

/**
 * Topics a host publishes from its own ports rather than its event log:
 * terminals and drafts. Each stream part follows its kinds of a stream's
 * topics and changes with them.
 */

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

/** Off the local link, a draft's autosaves reach a reader at most this often. */
export const DRAFT_SAVE_INTERVAL_MS = 5_000

/** A host's draft changes (`DraftControl.watch`). */
export interface DraftEventSource {
  watch(listener: (event: DraftChangedEvent) => void): () => void
}

/**
 * The `drafts` topic of one stream, without attachment bytes (a composer reads
 * them with `draft.open`). With `throttleSaves` a draft's autosaves go out at
 * most once per {@link DRAFT_SAVE_INTERVAL_MS}, latest first: rows only need to
 * catch up, and lease or delete changes go out at once, replacing a save still
 * waiting.
 */
export function openDraftStream(opts: {
  source: DraftEventSource
  environmentId: string
  topics: readonly TopicRef[]
  throttleSaves: boolean
  push: (event: DraftChangedEvent) => void
}): EventStreamHandle {
  let following = false
  const pending = new Map<string, { event: DraftChangedEvent; timer: ReturnType<typeof setTimeout> }>()
  const cancel = (draftId: string) => {
    clearTimeout(pending.get(draftId)?.timer)
    pending.delete(draftId)
  }
  const send = (event: DraftChangedEvent) => opts.push(event.draft ? { ...event, draft: withoutDraftAttachmentBytes(event.draft) } : event)
  const setTopics = (topics: readonly TopicRef[]) => {
    following = topics.some((topic) => topic.kind === 'drafts' && topic.environmentId === opts.environmentId)
    if (!following) for (const draftId of [...pending.keys()]) cancel(draftId)
  }
  setTopics(opts.topics)
  const off = opts.source.watch((event) => {
    if (!following) return
    if (!opts.throttleSaves || event.reason !== 'saved') {
      cancel(event.draftId)
      send(event)
      return
    }
    const queued = pending.get(event.draftId)
    if (queued) {
      queued.event = event
      return
    }
    const timer = setTimeout(() => {
      const latest = pending.get(event.draftId)
      pending.delete(event.draftId)
      if (latest) send(latest.event)
    }, DRAFT_SAVE_INTERVAL_MS)
    pending.set(event.draftId, { event, timer })
  })
  return {
    setTopics,
    close: () => {
      off()
      for (const draftId of [...pending.keys()]) cancel(draftId)
    },
  }
}

/** One handle over a stream's parts: topic changes and close reach each. */
export function combineStreams(...parts: Array<EventStreamHandle | null>): EventStreamHandle {
  const live = parts.filter((part): part is EventStreamHandle => part !== null)
  return {
    setTopics: (topics) => { for (const part of live) part.setTopics(topics) },
    close: () => { for (const part of live) part.close() },
  }
}
