import { afterEach, describe, expect, it } from 'vitest'
import type { EnvironmentEventEnvelope, SessionStreamFrame } from '@superone/shared/environment'
import { openNodeDatabase, type NodeDatabase } from '../db'
import { EventLog } from '../session/event-log'
import { openEventStream, type EventStreamCursor } from './event-stream'

const dbs: NodeDatabase[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close() })

function log(): EventLog {
  const db = openNodeDatabase(':memory:')
  dbs.push(db)
  return new EventLog(db, 'env')
}

/** A host over `events`, paging two durable events at a time. */
function source(events: EventLog) {
  return {
    listEventsAfter: (after: string) => events.listAfter(after, 2),
    streamEpoch: () => events.epoch,
    streamingAfter: (sessionId: string, version: number) => events.streamingAfter(sessionId, version),
    streamingEvents: () => events.streaming(),
    onEventsAppended: (fn: (envelope: EnvironmentEventEnvelope) => void) => events.onAppend(fn),
    viewEvent: (envelope: EnvironmentEventEnvelope) => envelope,
  }
}

const durable = (events: EventLog, sessionId: string, n: number) =>
  events.appendSession({ sessionId, eventType: 'session.agent_event', payload: { event: { type: 'status_change', status: 'streaming' }, n } })
const text = (events: EventLog, sessionId: string, messageId: string, chunk: string) =>
  events.appendSession({ sessionId, eventType: 'session.agent_event', payload: { event: { type: 'content_delta', messageId, delta: { type: 'text', text: chunk } } } })
const complete = (events: EventLog, sessionId: string, messageId: string) =>
  events.appendSession({ sessionId, eventType: 'session.agent_event', payload: { event: { type: 'message_complete', messageId } } })

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function open(events: EventLog, cursor: EventStreamCursor, filter = {}) {
  const frames: SessionStreamFrame[] = []
  const close = openEventStream({ source: source(events), environmentId: 'env', reader: { clientSessionId: 'c' }, cursor, filter, push: (f) => { frames.push(f) } })
  const texts = () => frames.flatMap((f) => f.events).map((e) => (e.payload as { event: { delta?: { text: string } } }).event.delta?.text).filter(Boolean)
  return { frames, close, texts }
}

describe('openEventStream', () => {
  it('catches up from the cursor in pages, then pushes new events as they commit', async () => {
    const events = log()
    for (let n = 1; n <= 3; n++) durable(events, 's1', n)
    const { frames } = open(events, { afterSequence: '1' })

    expect(frames.map((f) => f.events.map((e) => e.sequence))).toEqual([['2', '3']])

    durable(events, 's1', 4)
    durable(events, 's1', 5)
    expect(frames).toHaveLength(1)
    await flush()
    expect(frames.map((f) => f.sequence)).toEqual(['3', '5'])
    expect(frames.every((f) => f.epoch === events.epoch)).toBe(true)
  })

  it('filters by aggregate and still advances the cursor past dropped events', async () => {
    const events = log()
    const { frames } = open(events, { afterSequence: '0' }, { aggregateIds: new Set(['s1']) })

    durable(events, 's2', 1)
    durable(events, 's1', 2)
    durable(events, 's2', 3)
    await flush()

    expect(frames).toEqual([expect.objectContaining({ sequence: '3', events: [expect.objectContaining({ aggregateId: 's1' })] })])
  })

  it('stops pushing once closed', async () => {
    const events = log()
    const { frames, close } = open(events, { afterSequence: '0' })
    close()
    durable(events, 's1', 1)
    await flush()
    expect(frames).toEqual([])
  })

  it('streams text deltas live without storing them, in order with durable events', async () => {
    const events = log()
    const { frames, texts } = open(events, { afterSequence: '0' })
    durable(events, 's1', 1)
    text(events, 's1', 'm1', 'a')
    text(events, 's1', 'm1', 'b')
    await flush()

    expect(texts()).toEqual(['a', 'b'])
    expect(frames.flatMap((f) => f.events.map((e) => e.sessionVersion))).toEqual([1, 2, 3])
    expect(events.listAfter('0')).toHaveLength(1)
  })

  it('resumes a session above its version: missed text from the ring, merged with durable events', () => {
    const events = log()
    durable(events, 's1', 1)
    text(events, 's1', 'm1', 'a')
    // The reader saw up to here.
    text(events, 's1', 'm1', 'b')
    durable(events, 's1', 2)
    text(events, 's1', 'm1', 'c')

    const { frames, texts } = open(events, { afterSequence: '1', epoch: events.epoch, versions: { s1: 2 } })
    expect(texts()).toEqual(['b', 'c'])
    expect(frames.flatMap((f) => f.events.map((e) => e.sessionVersion))).toEqual([3, 4, 5])
    expect(frames.some((f) => f.resnapshot)).toBe(false)
  })

  it('names a session to resnapshot when its missed text is committed away, and streams it on from there', async () => {
    const events = log()
    text(events, 's1', 'm1', 'a')
    text(events, 's1', 'm1', 'b')
    complete(events, 's1', 'm1')

    const { frames, texts } = open(events, { afterSequence: '0', epoch: events.epoch, versions: { s1: 1 } })
    expect(frames[0]?.resnapshot).toEqual(['s1'])
    expect(frames[0]?.recover).toEqual([{ kind: 'session', environmentId: 'env', sessionId: 's1' }])
    expect(frames.flatMap((f) => f.events)).toEqual([])

    text(events, 's1', 'm2', 'c')
    await flush()
    expect(texts()).toEqual(['c'])
  })

  it('names every known session to resnapshot after the node restarted', () => {
    const events = log()
    durable(events, 's1', 1)
    const { frames } = open(events, { afterSequence: '1', epoch: 'previous-process', versions: { s1: 1, s2: 4 } })
    expect(frames[0]?.resnapshot?.sort()).toEqual(['s1', 's2'])
  })

  it('starts a reader without versions at the streaming events after its cursor', () => {
    const events = log()
    text(events, 's1', 'm1', 'before')
    durable(events, 's1', 1)
    text(events, 's1', 'm1', 'after')
    const { texts } = open(events, { afterSequence: '1' })
    expect(texts()).toEqual(['after'])
  })

  it('follows only the subscribed topics, a wildcard covering every session', async () => {
    const events = log()
    durable(events, 's1', 1)
    durable(events, 's2', 2)
    const one = open(events, { afterSequence: '0' }, { topics: [{ kind: 'session', environmentId: 'env', sessionId: 's2' }] })
    const all = open(events, { afterSequence: '0' }, { topics: [{ kind: 'session', environmentId: 'env', sessionId: '*' }] })
    const elsewhere = open(events, { afterSequence: '0' }, { topics: [{ kind: 'session', environmentId: 'other', sessionId: '*' }] })
    durable(events, 's1', 3)
    await flush()
    expect(one.frames.flatMap((f) => f.events.map((e) => e.aggregateId))).toEqual(['s2'])
    expect(all.frames.flatMap((f) => f.events.map((e) => e.aggregateId))).toEqual(['s1', 's2', 's1'])
    expect(elsewhere.frames.flatMap((f) => f.events)).toEqual([])
    // The cursor still moves past what the topic filter dropped.
    expect(one.frames.at(-1)?.sequence).toBe('2')
  })

  it('names only the subscribed topics to recover after the node restarted', () => {
    const events = log()
    const { frames } = open(events, { afterSequence: '0', epoch: 'previous-process', versions: { s1: 1, s2: 4 } }, {
      topics: [{ kind: 'session', environmentId: 'env', sessionId: 's2' }],
    })
    expect(frames[0]?.recover).toEqual([{ kind: 'session', environmentId: 'env', sessionId: 's2' }])
  })
})
