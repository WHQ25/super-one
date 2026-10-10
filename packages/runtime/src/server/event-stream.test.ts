import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionStreamFrame } from '@superone/shared/environment'
import { EventLog } from '../session/event-log'
import { openEventStream } from './event-stream'

const dbs: Database.Database[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close() })

function log(): EventLog {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE environment_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      timestamp INTEGER NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      causation_request_id TEXT,
      environment_id TEXT NOT NULL
    );
  `)
  dbs.push(db)
  return new EventLog(db as never, 'env')
}

function source(events: EventLog) {
  return { listEventsAfter: (after: string) => events.listAfter(after, 2), onEventsAppended: (fn: () => void) => events.onAppend(fn) }
}

const append = (events: EventLog, sessionId: string, n: number) =>
  events.appendSession({ sessionId, eventType: 'session.agent_event', payload: { n } })

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('openEventStream', () => {
  it('catches up from the cursor in pages, then pushes new events as they commit', async () => {
    const events = log()
    for (let n = 1; n <= 3; n++) append(events, 's1', n)
    const frames: SessionStreamFrame[] = []
    openEventStream({ source: source(events), reader: { clientSessionId: 'c' }, afterSequence: '1', filter: {}, push: (f) => { frames.push(f) } })

    expect(frames.map((f) => f.events.map((e) => e.sequence))).toEqual([['2', '3']])

    append(events, 's1', 4)
    append(events, 's1', 5)
    expect(frames).toHaveLength(1)
    await flush()
    expect(frames.map((f) => f.sequence)).toEqual(['3', '5'])
  })

  it('filters by aggregate and still advances the cursor past dropped events', async () => {
    const events = log()
    const frames: SessionStreamFrame[] = []
    openEventStream({ source: source(events), reader: { clientSessionId: 'c' }, afterSequence: '0', filter: { aggregateIds: new Set(['s1']) }, push: (f) => { frames.push(f) } })

    append(events, 's2', 1)
    append(events, 's1', 2)
    append(events, 's2', 3)
    await flush()

    expect(frames).toEqual([expect.objectContaining({ sequence: '2', events: [expect.objectContaining({ aggregateId: 's1' })] })])
    append(events, 's1', 4)
    await flush()
    expect(frames.at(-1)).toMatchObject({ sequence: '4' })
  })

  it('stops pushing once closed', async () => {
    const events = log()
    const frames: SessionStreamFrame[] = []
    const close = openEventStream({ source: source(events), reader: { clientSessionId: 'c' }, afterSequence: '0', filter: {}, push: (f) => { frames.push(f) } })
    close()
    append(events, 's1', 1)
    await flush()
    expect(frames).toEqual([])
  })
})
