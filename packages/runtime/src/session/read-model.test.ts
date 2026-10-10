import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { openNodeDatabase, type NodeDatabase } from '../db'
import { EventLog } from './event-log'
import { sessionReadModel } from './read-model'
import { SessionRuntime, type TurnRunner } from './session-runtime'
import { createSqliteSessionStore } from './sqlite-session-store'

const dirs: string[] = []
const dbs: NodeDatabase[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.open) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const client = { clientSessionId: 'c1' }
const lease = { leaseId: 'l1', generation: 'g1' }

/** A node over the database at `path`; a second boot over the same path is a restart. */
function boot(path: string, runner: TurnRunner = async () => ({ finalText: '', providerResume: null })) {
  const db = openNodeDatabase(path)
  dbs.push(db)
  const events = new EventLog(db, 'env')
  const runtime = new SessionRuntime(createSqliteSessionStore(db), events, { assertValid: () => {} }, 'env', runner, {
    readModel: sessionReadModel(db, events),
    runtimeReaperIntervalMs: 0,
  })
  return { db, events, runtime }
}

function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'read-model-'))
  dirs.push(dir)
  return join(dir, 'node.db')
}

/** A Claude-like turn: a tool, then streamed text, completed. */
function scriptedTurn(stopBefore?: 'text' | 'complete'): TurnRunner {
  return async ({ messageId: id, onAgentEvent }) => {
    const messageId = id!
    const emit = (event: AgentEvent) => onAgentEvent?.(event)
    emit({ type: 'message_start', message: { id: messageId, role: 'assistant', status: 'streaming', content: [], createdAt: new Date().toISOString(), providerId: 'claude' } })
    emit({ type: 'content_delta', messageId, delta: { type: 'tool_use', toolName: 'Read', toolUseId: 't1', input: '{"file":"a"}' } })
    emit({ type: 'content_delta', messageId, delta: { type: 'tool_result', toolUseId: 't1', summary: 'ok' } })
    if (stopBefore === 'text') return new Promise(() => {})
    emit({ type: 'content_delta', messageId, delta: { type: 'text', text: 'Hello ' } })
    emit({ type: 'content_delta', messageId, delta: { type: 'text', text: 'world' } })
    if (stopBefore === 'complete') return new Promise(() => {})
    emit({ type: 'message_complete', messageId })
    return { finalText: 'Hello world', providerResume: null, skipAssistantTranscript: true }
  }
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(check()).toBe(true)
}

const textOf = (message: { content: Array<{ type: string; text?: string }> }) =>
  message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')

describe('SessionReadModel', () => {
  it('loads before and after stable anchors without losing the current turn outside a history window', async () => {
    const node = boot(dbPath(), scriptedTurn())
    const session = node.runtime.create({ projectId: 'p', harnessId: 'claude' })
    await node.runtime.send({ sessionId: session.sessionId, text: 'first', clientMessageId: 'u1', client, ...lease })
    await until(() => node.runtime.get(session.sessionId)?.status === 'idle')
    await node.runtime.send({ sessionId: session.sessionId, text: 'second', clientMessageId: 'u2', client, ...lease })
    await until(() => node.runtime.get(session.sessionId)?.status === 'idle')
    const before = node.runtime.load({ sessionId: session.sessionId, anchorId: 'u2', direction: 'before', limit: 2 })
    expect(before.messages.map(row => row.role)).toEqual(['user', 'assistant'])
    expect(before.activeTurn?.map(row => row.role)).toEqual(['user', 'assistant'])
    expect(before).toMatchObject({ before: null, after: 2 })
    const history = node.runtime.load({ sessionId: session.sessionId, anchorId: 'u2', direction: 'before', limit: 2, includeState: false })
    expect(history.messages).toEqual(before.messages)
    expect(history.cursor).toEqual(before.cursor)
    expect(history.state).toEqual({})
    expect(history.activeTurn).toBeUndefined()
    const after = node.runtime.load({ sessionId: session.sessionId, anchorId: 'u2', direction: 'after' })
    expect(after.messages.map(row => row.role)).toEqual(['assistant'])
    expect(after.activeTurn?.map(row => row.id)).toEqual(['u2'])
    expect(after.after).toBeNull()
    expect(() => node.runtime.load({ sessionId: session.sessionId, anchorId: 'missing' })).toThrow('History message no longer exists')
    await node.runtime.dispose()
  })

  it('keeps streamed text only in memory until its message commits, then from the checkpoint across a restart', async () => {
    const path = dbPath()
    const node = boot(path, scriptedTurn())
    const session = node.runtime.create({ projectId: 'p', harnessId: 'claude' })
    await node.runtime.send({ sessionId: session.sessionId, text: 'hi', clientMessageId: 'u1', client, ...lease })
    await until(() => node.runtime.get(session.sessionId)?.status === 'idle')

    const stored = node.events.listForSession(session.sessionId)
    expect(stored.some((e) => JSON.stringify(e.payload).includes('Hello'))).toBe(false)
    const assistant = node.runtime.load({ sessionId: session.sessionId }).messages.at(-1)!
    expect(textOf(assistant)).toBe('Hello world')
    node.db.close()

    const restarted = boot(path)
    const loaded = restarted.runtime.load({ sessionId: session.sessionId })
    expect(loaded.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(textOf(loaded.messages[1]!)).toBe('Hello world')
    expect(loaded.messages[1]!.content.map((b) => b.type)).toEqual(['tool_use', 'tool_result', 'text'])
  })

  it('serves the partial text of a message still streaming, at the version of its last event', async () => {
    const node = boot(dbPath(), scriptedTurn('complete'))
    const session = node.runtime.create({ projectId: 'p', harnessId: 'claude' })
    await node.runtime.send({ sessionId: session.sessionId, text: 'hi', clientMessageId: 'u1', client, ...lease })
    await until(() => node.events.streaming().length === 2)

    const loaded = node.runtime.load({ sessionId: session.sessionId })
    expect(textOf(loaded.messages.at(-1)!)).toBe('Hello world')
    expect(loaded.cursor).toEqual({ sequence: node.events.headSequence(), epoch: node.events.epoch, version: node.events.sessionVersion(session.sessionId) })
  })

  it('after a node is killed mid-turn keeps the finished tools and marks the turn interrupted', async () => {
    const path = dbPath()
    const node = boot(path, scriptedTurn('complete'))
    const session = node.runtime.create({ projectId: 'p', harnessId: 'claude' })
    await node.runtime.send({ sessionId: session.sessionId, text: 'hi', clientMessageId: 'u1', client, ...lease })
    await until(() => node.events.streaming().length === 2)
    node.db.close()

    const restarted = boot(path)
    const loaded = restarted.runtime.load({ sessionId: session.sessionId })
    const assistant = loaded.messages.at(-1)!
    expect(assistant.content.map((b) => b.type)).toEqual(['tool_use', 'tool_result'])
    expect(assistant.status).not.toBe('streaming')
    expect(loaded.state.status).toBe('idle')
  })

  it('builds a session logged before the read model from its stored deltas, once', () => {
    const path = dbPath()
    const node = boot(path)
    const session = node.runtime.create({ projectId: 'p', harnessId: 'claude' })
    // An older node stored every delta as a row, with no version.
    const insert = node.db.prepare(`INSERT INTO environment_events (event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version, payload_json, environment_id)
      VALUES (?, 0, 'session', ?, ?, 1, ?, 'env')`)
    insert.run('e1', session.sessionId, 'session.user_message', JSON.stringify({ blockId: 'u1', text: 'hi' }))
    for (const [id, event] of [
      ['e2', { type: 'message_start', message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: new Date(0).toISOString() } }],
      ['e3', { type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'old ' } }],
      ['e4', { type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'answer' } }],
      ['e5', { type: 'message_complete', messageId: 'a1' }],
    ] as const) insert.run(id, session.sessionId, 'session.agent_event', JSON.stringify({ event }))
    node.db.prepare(`UPDATE sessions SET transcript_json = ? WHERE session_id = ?`).run(
      JSON.stringify([{ id: 'u1', role: 'user', text: 'hi', createdAt: 0 }, { id: 'a1', role: 'assistant', text: 'old answer', createdAt: 0 }]),
      session.sessionId,
    )
    node.db.prepare(`DELETE FROM session_read_models`).run()
    node.db.close()

    const restarted = boot(path)
    const loaded = restarted.runtime.load({ sessionId: session.sessionId })
    expect(loaded.messages.map((m) => [m.role, textOf(m)])).toEqual([['user', 'hi'], ['assistant', 'old answer']])
    expect(restarted.db.prepare(`SELECT COUNT(*) AS n FROM session_messages WHERE session_id = ?`).get(session.sessionId)).toEqual({ n: 2 })
  })
})
