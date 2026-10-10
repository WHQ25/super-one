import type { EnvironmentAggregateType, EnvironmentEventEnvelope, SessionStreamFrame } from '@superone/shared/environment'
import { topicKey, topicsOfEnvelope, topicWildcardKey, type TopicRef } from '@superone/shared/environment/topics'

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
  /** Only events of these topics (a `*` instance covers its kind). */
  topics?: readonly TopicRef[]
}

/** Whether an envelope belongs to one of `topics`. */
function topicMatcher(topics: readonly TopicRef[] | undefined): ((envelope: EnvironmentEventEnvelope) => boolean) | null {
  if (!topics) return null
  const keys = new Set(topics.map(topicKey))
  return (envelope) => topicsOfEnvelope(envelope).some((topic) => {
    const wildcard = topicWildcardKey(topic)
    return keys.has(topicKey(topic)) || (wildcard !== null && keys.has(wildcard))
  })
}

/** The filter as a predicate over envelopes. */
export function streamFilterMatcher(filter: EventStreamFilter): (envelope: EnvironmentEventEnvelope) => boolean {
  const inTopics = topicMatcher(filter.topics)
  return (envelope) =>
    (!filter.aggregateIds || filter.aggregateIds.has(envelope.aggregateId))
    && (!filter.aggregateTypes || filter.aggregateTypes.has(envelope.aggregateType))
    && (!inTopics || inTopics(envelope))
}

/** Whether a session id is inside the stream's filter. */
function coversSession(filter: EventStreamFilter, environmentId: string, sessionId: string): boolean {
  return streamFilterMatcher(filter)({ aggregateType: 'session', aggregateId: sessionId, environmentId } as EnvironmentEventEnvelope)
}

/**
 * The connection's pace. While it is congested the stream holds new events;
 * past `budgetBytes` held, a session's streaming events are dropped and the
 * session goes to `resnapshot` instead. Durable events are never dropped.
 */
export interface EventStreamFlow {
  congested(): boolean
  onDrain(listener: () => void): () => void
  budgetBytes: number
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
  /** The environment the log belongs to; names the topics a recovery signal covers. */
  environmentId: string
  reader: { clientSessionId: string }
  cursor: EventStreamCursor
  filter: EventStreamFilter
  push: (frame: SessionStreamFrame) => void
  flow?: EventStreamFlow
}): () => void {
  const { source, environmentId, reader, filter, push, flow } = input
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
  /** Approximate bytes of `live` while the connection is congested. */
  let heldBytes = 0
  let heldSizes: number[] = []
  /** Sessions whose held streaming events were dropped; they go out as `resnapshot`. */
  const degraded = new Set<string>()

  const matches = streamFilterMatcher(filter)

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
    push({
      sequence,
      epoch,
      events,
      ...(gone.length ? {
        resnapshot: gone,
        recover: gone.map((sessionId): TopicRef => ({ kind: 'session', environmentId: environmentId, sessionId })),
      } : {}),
    })
  }

  // Ring events held for catch-up, per session, and the sessions found gone.
  const held: EnvironmentEventEnvelope[] = []
  const gone: string[] = [...resnapshot].filter((id) => coversSession(filter, environmentId, id))
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
    if (flow?.congested()) return
    const batch = live
    live = []
    heldSizes = []
    heldBytes = 0
    const dropped = [...degraded]
    degraded.clear()
    for (const sessionId of dropped) versions.delete(sessionId)
    const events = batch.filter(take)
    for (const envelope of batch) {
      if (!envelope.ephemeral && BigInt(envelope.sequence) > BigInt(sequence)) sequence = envelope.sequence
    }
    send(events, dropped)
  }

  const isStreamingSessionEvent = (envelope: EnvironmentEventEnvelope): boolean =>
    envelope.ephemeral === true && envelope.aggregateType === 'session'

  /** Over budget: the held streaming events give way to a resnapshot of their sessions. */
  const degrade = (): void => {
    const kept: EnvironmentEventEnvelope[] = []
    const keptSizes: number[] = []
    live.forEach((envelope, index) => {
      if (isStreamingSessionEvent(envelope) && matches(envelope)) {
        degraded.add(envelope.aggregateId)
        return
      }
      kept.push(envelope)
      keptSizes.push(heldSizes[index]!)
    })
    live = kept
    heldSizes = keptSizes
    heldBytes = keptSizes.reduce((sum, size) => sum + size, 0)
  }

  const hold = (envelope: EnvironmentEventEnvelope): void => {
    if (isStreamingSessionEvent(envelope) && degraded.has(envelope.aggregateId)) return
    const size = JSON.stringify(envelope).length
    live.push(envelope)
    heldSizes.push(size)
    heldBytes += size
    if (heldBytes > flow!.budgetBytes) degrade()
  }

  const unsubscribe = source.onEventsAppended((envelope) => {
    if (closed) return
    const viewed = envelope.ephemeral ? envelope : source.viewEvent(envelope, reader)
    if (caughtUp && flow?.congested()) {
      hold(viewed)
      return
    }
    live.push(viewed)
    heldSizes.push(0)
    if (!caughtUp || flushing) return
    flushing = true
    queueMicrotask(flush)
  })
  const stopDrain = flow?.onDrain(() => {
    if (!closed && !flushing && (live.length > 0 || degraded.size > 0)) flush()
  })
  catchUp()
  caughtUp = true
  if (live.length) flush()

  return () => {
    closed = true
    unsubscribe()
    stopDrain?.()
  }
}
