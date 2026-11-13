import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import { EventLog, cursorTooOldDetails } from './event-log'
import { compactEnvironmentEvents, readNodeEventStats } from './event-log-compact'

const dbs: NodeDatabase[] = []
const dirs: string[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function open(): NodeDatabase {
  const db = openNodeDatabase(':memory:')
  dbs.push(db)
  return db
}

function session(db: NodeDatabase, id: string, status = 'idle', pending: string | null = null): void {
  db.prepare(
    `INSERT INTO sessions (
      session_id, project_id, harness_id, provider_id, status, transcript_json, pending_interaction_json, created_at, updated_at, is_hidden
    ) VALUES (?, 'p', 'claude', 'claude', ?, '[]', ?, 0, 0, 0)`,
  ).run(id, status, pending)
}

function checkpoint(db: NodeDatabase, id: string, applied: number): void {
  db.prepare(
    `INSERT INTO session_read_models (session_id, applied_version, state_json, updated_at) VALUES (?, ?, '{}', 1)`,
  ).run(id, applied)
}

function add(db: NodeDatabase, sequence: number, sessionId: string, eventType: string, payload: unknown, version = sequence): void {
  db.prepare(
    `INSERT INTO environment_events (
      sequence, event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version, payload_json, environment_id, session_version
    ) VALUES (?, ?, 1, 'session', ?, ?, 1, ?, 'env', ?)`,
  ).run(sequence, `e${sequence}`, sessionId, eventType, JSON.stringify(payload), version)
}

function agent(type: string, extra: Record<string, unknown> = {}): unknown {
  return { event: { type, ...extra } }
}

function sequences(db: NodeDatabase): number[] {
  return (db.prepare('SELECT sequence FROM environment_events ORDER BY sequence').all() as { sequence: number }[]).map((row) => row.sequence)
}

describe('compactEnvironmentEvents', () => {
  it('drops streaming rows at or below the checkpoint and keeps the turn record', () => {
    const db = open()
    session(db, 's')
    add(db, 1, 's', 'session.user_message', { text: 'hi' }, 1)
    add(db, 2, 's', 'session.agent_event', agent('content_delta', { messageId: 'm', delta: { type: 'text', text: 'a' } }), 2)
    add(db, 3, 's', 'session.tool_started', { name: 'bash' }, 3)
    add(db, 4, 's', 'session.permission_responded', { allow: true }, 4)
    add(db, 5, 's', 'session.agent_event', agent('content_delta', { messageId: 'm', delta: { type: 'text', text: 'b' } }), 5)
    checkpoint(db, 's', 4)

    const result = compactEnvironmentEvents(db, { now: 50 })

    expect(sequences(db)).toEqual([1, 3, 4, 5])
    expect(result).toMatchObject({ removedRows: 1, floor: '2', vacuum: 'not-requested' })
    expect(result.freedBytes).toBeGreaterThan(0)
    const stats = readNodeEventStats(db)
    expect(stats).toMatchObject({ rows: 4, retentionFloor: '2', lastCompactAt: 50, lastFreedBytes: result.freedBytes })
  })

  it('treats thinking, command output, tool progress and the old delta event types as streaming', () => {
    const db = open()
    session(db, 's')
    add(db, 1, 's', 'session.assistant_delta', { blockId: 'b', delta: 'x' }, 1)
    add(db, 2, 's', 'session.tool_input_delta', { text: '{' }, 2)
    add(db, 3, 's', 'session.agent_event', agent('content_delta', { messageId: 'm', delta: { type: 'thinking', text: 'hmm' } }), 3)
    add(db, 4, 's', 'session.agent_event', agent('content_delta', { messageId: 'm', delta: { type: 'tool_use', outputDelta: 'ls' } }), 4)
    add(db, 5, 's', 'session.agent_event', agent('tool_input_delta', { messageId: 'm' }), 5)
    add(db, 6, 's', 'session.agent_event', agent('tool_progress', { messageId: 'm' }), 6)
    add(db, 7, 's', 'session.agent_event', agent('content_delta', { messageId: 'm', delta: { type: 'tool_use', name: 'bash' } }), 7)
    checkpoint(db, 's', 7)

    compactEnvironmentEvents(db)

    expect(sequences(db)).toEqual([7])
  })

  it('skips a streaming session and one waiting on a question', () => {
    const db = open()
    session(db, 'live', 'streaming')
    session(db, 'ask', 'idle', JSON.stringify({ kind: 'question' }))
    add(db, 1, 'live', 'session.agent_event', agent('content_delta', { messageId: 'm', delta: { type: 'text', text: 'a' } }), 1)
    add(db, 2, 'ask', 'session.assistant_delta', { delta: 'q' }, 1)
    checkpoint(db, 'live', 9)
    checkpoint(db, 'ask', 9)

    compactEnvironmentEvents(db)

    expect(sequences(db)).toEqual([1, 2])
    expect(readNodeEventStats(db).retentionFloor).toBe('0')
  })

  it('skips a session the host still marks busy', () => {
    const db = open()
    session(db, 's')
    add(db, 1, 's', 'session.assistant_delta', { delta: 'a' }, 1)
    checkpoint(db, 's', 1)

    compactEnvironmentEvents(db, { busySessionIds: ['s'] })

    expect(sequences(db)).toEqual([1])
  })

  it('keeps the newest catalog snapshot below the checkpoint and anything above it', () => {
    const db = open()
    session(db, 's')
    add(db, 1, 's', 'session.agent_event', agent('acp_commands', { commands: ['old'] }), 1)
    add(db, 2, 's', 'session.agent_event', agent('acp_commands', { commands: ['new'] }), 2)
    add(db, 3, 's', 'session.agent_event', agent('session_commands', { commands: ['a'] }), 3)
    add(db, 4, 's', 'session.agent_event', agent('session_capabilities', { tools: ['bash'] }), 4)
    add(db, 5, 's', 'session.agent_event', agent('acp_commands', { commands: ['live'] }), 5)
    checkpoint(db, 's', 4)

    compactEnvironmentEvents(db)

    expect(sequences(db)).toEqual([2, 3, 4, 5])
  })

  it('collapses usage snapshots per message and keeps a newer row above the checkpoint', () => {
    const db = open()
    session(db, 's')
    add(db, 1, 's', 'session.agent_event', agent('message_usage', { messageId: 'm1', tokens: 1 }), 1)
    add(db, 2, 's', 'session.agent_event', agent('message_usage', { messageId: 'm1', tokens: 2 }), 2)
    add(db, 3, 's', 'session.agent_event', agent('message_usage', { messageId: 'm2', tokens: 3 }), 3)
    add(db, 4, 's', 'session.agent_event', agent('message_usage', { messageId: 'm1', tokens: 9 }), 4)
    checkpoint(db, 's', 3)

    compactEnvironmentEvents(db)

    expect(sequences(db)).toEqual([2, 3, 4])
  })

  it('deletes every event of a removed session and leaves a session with no checkpoint', () => {
    const db = open()
    session(db, 'fresh')
    add(db, 1, 'fresh', 'session.user_message', { text: 'stay' }, 1)
    add(db, 2, 'gone', 'session.user_message', { text: 'bye' }, 1)
    add(db, 3, 'gone', 'session.removed', {}, 2)
    add(db, 4, 'other', 'session.agent_event', agent('status_change', { status: 'idle' }), 1)

    const result = compactEnvironmentEvents(db)

    expect(sequences(db)).toEqual([1, 4])
    expect(result.floor).toBe('3')
  })

  it('sets the floor to the highest deleted sequence and refuses an older cursor', () => {
    const db = open()
    session(db, 's')
    add(db, 50, 's', 'session.assistant_delta', { delta: 'a' }, 1)
    add(db, 200, 's', 'session.assistant_delta', { delta: 'b' }, 2)
    add(db, 201, 's', 'session.user_message', { text: 'keep' }, 3)
    checkpoint(db, 's', 2)
    const log = new EventLog(db, 'env')

    const result = compactEnvironmentEvents(db)

    expect(result.floor).toBe('200')
    expect(() => log.listAfter('199')).toThrow(/retained history/)
    try {
      log.listAfter('199')
    } catch (err) {
      expect(cursorTooOldDetails(err)).toEqual({ floor: '200', head: '201' })
    }
    expect(log.listAfter('200').map((event) => event.sequence)).toEqual(['201'])
    compactEnvironmentEvents(db)
    expect(readNodeEventStats(db).retentionFloor).toBe('200')
  })

  it('vacuums a file database when there is room and skips when there is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'superone-event-compact-'))
    dirs.push(dir)
    const filePath = join(dir, 'node.db')
    const db = openNodeDatabase(filePath)
    dbs.push(db)
    session(db, 's')
    add(db, 1, 's', 'session.user_message', { text: 'hi' }, 1)
    checkpoint(db, 's', 1)

    expect(compactEnvironmentEvents(db, { vacuum: true, filePath, freeBytes: 0 }).vacuum).toBe('skipped')
    expect(compactEnvironmentEvents(db, { vacuum: true, filePath }).vacuum).toBe('done')
    expect(compactEnvironmentEvents(open(), { vacuum: true }).vacuum).toBe('skipped')
  })

  it('keeps headSequence at or above retentionFloor when the highest sequence rows are removed', () => {
    const db = open()
    session(db, 's1')
    add(db, 1, 's1', 'session.user_message', { text: 'stay' }, 1)
    add(db, 9, 's2', 'session.user_message', { text: 'gone' }, 1)
    add(db, 10, 's2', 'session.removed', {}, 2)

    const result = compactEnvironmentEvents(db)
    expect(result.floor).toBe('10')

    const coldLog = new EventLog(db, 'env')
    expect(coldLog.headSequence()).toBe('10')
    try {
      coldLog.listAfter('5')
      expect.unreachable()
    } catch (err) {
      expect(cursorTooOldDetails(err)).toEqual({ floor: '10', head: '10' })
    }
    expect(coldLog.listAfter('10')).toEqual([])
  })

  it('trims external session logs to a retention window while preserving tail versions and busy sessions', () => {
    const db = open()
    const now = 100_000
    const windowMs = 10_000
    const insertTimed = (seq: number, sid: string, ts: number, eventType: string, payload: unknown, ver = seq) => {
      db.prepare(
        `INSERT INTO environment_events (
          sequence, event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version, payload_json, environment_id, session_version
        ) VALUES (?, ?, ?, 'session', ?, ?, 1, ?, 'env', ?)`,
      ).run(seq, `e${seq}`, ts, sid, eventType, JSON.stringify(payload), ver)
    }

    insertTimed(1, 'deleted', now - 1_000, 'session.user_message', { text: 'bye' }, 1)
    insertTimed(2, 'old-idle', now - 50_000, 'session.agent_event', agent('status_change', { status: 'streaming' }), 1)
    insertTimed(3, 'old-idle', now - 49_000, 'session.user_message', { text: 'old' }, 2)
    insertTimed(4, 'old-idle', now - 48_000, 'session.agent_event', agent('status_change', { status: 'idle' }), 3)
    insertTimed(5, 'old-idle', now - 47_000, 'session.renamed', { title: 'done' }, 4)
    insertTimed(6, 'recent-idle', now - 2_000, 'session.user_message', { text: 'recent' }, 1)
    insertTimed(7, 'recent-idle', now - 1_500, 'session.assistant_delta', { delta: 'chunk' }, 2)
    insertTimed(8, 'recent-idle', now - 1_000, 'session.agent_event', agent('status_change', { status: 'idle' }), 3)
    insertTimed(9, 'busy-live', now - 80_000, 'session.assistant_delta', { delta: 'live' }, 1)

    const result = compactEnvironmentEvents(db, {
      externalSessionIds: ['old-idle', 'recent-idle', 'busy-live'],
      busySessionIds: ['busy-live'],
      retainWindowMs: windowMs,
      now,
    })

    expect(sequences(db)).toEqual([4, 5, 6, 8, 9])
    expect(result.floor).toBe('7')
    const log = new EventLog(db, 'env')
    expect(log.sessionVersion('old-idle')).toBe(4)
    expect(log.sessionVersion('recent-idle')).toBe(3)
  })
})
