import type { EnvironmentAggregateType, EnvironmentEventEnvelope, SessionStreamFrame } from '@superone/shared/environment'

/** What a stream reads from: the host's durable log as one reader sees it. */
export interface EventStreamSource {
  listEventsAfter(afterSequence: string, reader?: { clientSessionId: string }): EnvironmentEventEnvelope[]
  onEventsAppended(listener: () => void): () => void
}

export interface EventStreamFilter {
  aggregateIds?: ReadonlySet<string>
  aggregateTypes?: ReadonlySet<EnvironmentAggregateType>
}

/**
 * One `session.subscribe`: the events after a cursor, then every new one,
 * pushed as they commit. Appends only wake the stream; it pulls with
 * `listEventsAfter`, so a burst of appends costs one read and the reader's
 * view of each event (mod events) is the same as `session.events`.
 *
 * Every frame carries `sequence`, the last durable sequence the stream has
 * scanned, including events the filter dropped, so a client resuming from it
 * neither misses nor rescans anything.
 */
export function openEventStream(input: {
  source: EventStreamSource
  reader: { clientSessionId: string }
  afterSequence: string
  filter: EventStreamFilter
  push: (frame: SessionStreamFrame) => void
}): () => void {
  const { source, reader, filter, push } = input
  let cursor = input.afterSequence
  let scheduled = false
  let closed = false

  const matches = (envelope: EnvironmentEventEnvelope): boolean =>
    (!filter.aggregateIds || filter.aggregateIds.has(envelope.aggregateId))
    && (!filter.aggregateTypes || filter.aggregateTypes.has(envelope.aggregateType))

  const drain = (): void => {
    scheduled = false
    while (!closed) {
      const page = source.listEventsAfter(cursor, reader)
      if (page.length === 0) return
      cursor = page[page.length - 1]!.sequence
      const events = page.filter(matches)
      if (events.length > 0) push({ sequence: cursor, events })
    }
  }

  const unsubscribe = source.onEventsAppended(() => {
    if (scheduled || closed) return
    scheduled = true
    queueMicrotask(drain)
  })
  drain()

  return () => {
    closed = true
    unsubscribe()
  }
}
