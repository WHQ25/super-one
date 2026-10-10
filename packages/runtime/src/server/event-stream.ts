import type { EnvironmentAggregateType, EnvironmentEventEnvelope, SessionStreamFrame } from '@superone/shared/environment'

/** What a stream reads from: the host's session log as one reader sees it. */
export interface EventStreamSource {
  /** Durable events strictly after `afterSequence`, one page, as `reader` sees them. */
  listEventsAfter(afterSequence: string, reader?: { clientSessionId: string }): EnvironmentEventEnvelope[]
  streamEpoch(): string
  /** A session's streaming events above `version`, or null when some are gone. */
  streamingAfter(sessionId: string, version: number): EnvironmentEventEnvelope[] | null
  /** Every streaming event held now, oldest first. */
  streamingEvents(): EnvironmentEventEnvelope[]
  /** Each committed event, durable or streaming. */
  onEventsAppended(listener: (envelope: EnvironmentEventEnvelope) => void): () => void
  /** A live event as `reader` sees it. */
  viewEvent(envelope: EnvironmentEventEnvelope, reader: { clientSessionId: string }): EnvironmentEventEnvelope
}

export interface EventStreamFilter {
  aggregateIds?: ReadonlySet<string>
  aggregateTypes?: ReadonlySet<EnvironmentAggregateType>
}

export interface EventStreamCursor {
  afterSequence: string
  /** Versions read per session, meaningful only within `epoch`. */
  epoch?: string
  versions?: Record<string, number>
}

/** Orders a streaming event after the durable event it followed. */
function position(envelope: EnvironmentEventEnvelope): [number, number, number] {
  return [Number(envelope.sequence), envelope.ephemeral ? 1 : 0, envelope.sessionVersion ?? 0]
}

function byPosition(a: EnvironmentEventEnvelope, b: EnvironmentEventEnvelope): number {
  const pa = position(a)
  const pb = position(b)
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
}

/**
 * One `session.subscribe`: the events after a cursor, then every new one as it
 * commits. Catch-up merges the durable log with the streaming events still
 * held, in the order they happened. A session the reader had versions for
 * resumes above them; when some of its events are gone (committed, evicted, or
 * from another epoch) the frame names it in `resnapshot` and the stream sends
 * only its new events from then on.
 *
 * Every frame carries `sequence`, the last durable sequence scanned, including
 * events the filter dropped, and the epoch, so the reader can resume from it.
 */
export function openEventStream(input: {
  source: EventStreamSource
  reader: { clientSessionId: string }
  cursor: EventStreamCursor
  filter: EventStreamFilter
  push: (frame: SessionStreamFrame) => void
}): () => void {
  const { source, reader, filter, push } = input
  const epoch = source.streamEpoch()
  let sequence = input.cursor.afterSequence
  const sameEpoch = input.cursor.epoch === epoch
  const versions = new Map<string, number>(sameEpoch ? Object.entries(input.cursor.versions ?? {}) : [])
  /** Sessions sent to resnapshot: catch-up skips them, live events flow. */
  const resnapshot = new Set<string>(sameEpoch ? [] : Object.keys(input.cursor.versions ?? {}))
  let caughtUp = false
  let closed = false
  let live: EnvironmentEventEnvelope[] = []
  let flushing = false

  const matches = (envelope: EnvironmentEventEnvelope): boolean =>
    (!filter.aggregateIds || filter.aggregateIds.has(envelope.aggregateId))
    && (!filter.aggregateTypes || filter.aggregateTypes.has(envelope.aggregateType))

  /** Whether the reader still needs this event; records it as read. */
  const take = (envelope: EnvironmentEventEnvelope): boolean => {
    if (envelope.aggregateType === 'session' && envelope.sessionVersion !== undefined) {
      const seen = versions.get(envelope.aggregateId)
      if (seen !== undefined && envelope.sessionVersion <= seen) return false
      versions.set(envelope.aggregateId, envelope.sessionVersion)
    } else if (!envelope.ephemeral && BigInt(envelope.sequence) <= BigInt(sequence)) {
      return false
    }
    return matches(envelope)
  }

  const send = (events: EnvironmentEventEnvelope[], gone: string[] = []): void => {
    if (events.length === 0 && gone.length === 0) return
    push({ sequence, epoch, events, ...(gone.length ? { resnapshot: gone } : {}) })
  }

  // Ring events held for catch-up, per session, and the sessions found gone.
  const held: EnvironmentEventEnvelope[] = []
  const gone: string[] = [...resnapshot].filter((id) => !filter.aggregateIds || filter.aggregateIds.has(id))
  for (const [sessionId, version] of versions) {
    const streaming = source.streamingAfter(sessionId, version)
    if (streaming === null) {
      resnapshot.add(sessionId)
      gone.push(sessionId)
    } else {
      held.push(...streaming)
    }
  }
  for (const envelope of source.streamingEvents()) {
    if (versions.has(envelope.aggregateId) || resnapshot.has(envelope.aggregateId)) continue
    if (BigInt(envelope.sequence) >= BigInt(sequence)) held.push(envelope)
  }
  held.sort(byPosition)
  for (const sessionId of resnapshot) versions.delete(sessionId)

  const catchUp = (): void => {
    let first = true
    while (!closed) {
      const page = source.listEventsAfter(sequence, reader)
      const pageEnd = page.at(-1)?.sequence
      // Streaming events that happened before this page's last durable event go with it.
      const ring: EnvironmentEventEnvelope[] = []
      while (held.length && (pageEnd === undefined || BigInt(held[0]!.sequence) < BigInt(pageEnd))) ring.push(held.shift()!)
      const events = [...page.filter((e) => !resnapshot.has(e.aggregateId)), ...ring].sort(byPosition).filter(take)
      if (pageEnd !== undefined) sequence = pageEnd
      send(events, first ? gone : [])
      first = false
      if (page.length === 0) return
    }
  }

  const flush = (): void => {
    flushing = false
    const batch = live
    live = []
    const events = batch.filter(take)
    for (const envelope of batch) {
      if (!envelope.ephemeral && BigInt(envelope.sequence) > BigInt(sequence)) sequence = envelope.sequence
    }
    send(events)
  }

  const unsubscribe = source.onEventsAppended((envelope) => {
    if (closed) return
    live.push(envelope.ephemeral ? envelope : source.viewEvent(envelope, reader))
    if (!caughtUp || flushing) return
    flushing = true
    queueMicrotask(flush)
  })
  catchUp()
  caughtUp = true
  if (live.length) flush()

  return () => {
    closed = true
    unsubscribe()
  }
}
