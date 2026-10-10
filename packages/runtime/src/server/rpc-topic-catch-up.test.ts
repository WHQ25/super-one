import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionStreamFrame } from '@superone/shared/environment'
import { openNodeDatabase, type NodeDatabase } from '../db'
import { EventLog } from '../session/event-log'
import { handleTopicCatchUp } from './rpc-topic-subscriptions'
import type { RpcContext, SessionHostPort } from './rpc-context'

const dbs: NodeDatabase[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close() })
function fixture() {
  const db = openNodeDatabase(':memory:'); dbs.push(db)
  const log = new EventLog(db, 'env')
  const onEventsAppended = vi.fn()
  const sessions = {
    listEventsAfter: (after: string) => log.listAfter(after, 2), streamEpoch: () => log.epoch,
    streamingAfter: (id: string, version: number) => log.streamingAfter(id, version), streamingEvents: () => log.streaming(),
    onEventsAppended, viewEvent: (event: unknown) => event,
    snapshotSequence: () => log.headSequence(),
  } as unknown as SessionHostPort
  const ctx = { sessions, identity: { environmentId: 'env' }, client: { clientSessionId: 'reader', scopes: ['session:read'] } } as RpcContext & { sessions: SessionHostPort }
  const topics = [{ kind: 'session', environmentId: 'env', sessionId: 's' }]
  const append = (event: Record<string, unknown>, sessionId = 's') => log.appendSession({ sessionId, eventType: 'session.agent_event', payload: { event } })
  return { log, ctx, topics, append, onEventsAppended }
}
describe('native cursor cut for a shared stream follower', () => {
  it('merges retained streaming events and paged durable events once, without a live subscription', () => {
    const f = fixture()
    f.append({ type: 'status_change', status: 'streaming' })
    f.append({ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'seen' } })
    f.append({ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'missed' } })
    f.append({ type: 'status_change', status: 'streaming' })
    f.append({ type: 'status_change', status: 'idle' }, 'other')
    const frame = handleTopicCatchUp({ afterSequence: '1', epoch: f.log.epoch, versions: { s: 2 }, topics: f.topics }, f.ctx).result as SessionStreamFrame
    expect(frame.events.map(event => [event.aggregateId, event.sessionVersion])).toEqual([['s', 3], ['s', 4]])
    expect(frame.resnapshot).toBeUndefined()
    expect(f.onEventsAppended).not.toHaveBeenCalled()
    expect(frame.sequence).toBe(f.log.headSequence())
  })
  it('advances a cut across pages belonging entirely to other topics', () => {
    const f = fixture()
    for (let i = 0; i < 5; i++) f.append({ type: 'status_change', status: 'idle' }, 'other')
    const frame = handleTopicCatchUp({ afterSequence: '0', topics: f.topics }, f.ctx).result as SessionStreamFrame
    expect(frame.events).toEqual([])
    expect(frame.sequence).toBe(f.log.headSequence())
  })
  it('requires a new snapshot when the source epoch or retained streaming history changed', () => {
    const f = fixture()
    f.append({ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'old' } })
    f.append({ type: 'content_delta', messageId: 'm', delta: { type: 'text', text: 'missed' } })
    f.append({ type: 'message_complete', messageId: 'm' })
    for (const epoch of [f.log.epoch, 'old-epoch']) {
      const frame = handleTopicCatchUp({ afterSequence: '0', epoch, versions: { s: 1 }, topics: f.topics }, f.ctx).result as SessionStreamFrame
      expect(frame.resnapshot).toEqual(['s'])
      expect(frame.recover).toEqual(f.topics)
      expect(frame.events).toEqual([])
    }
  })
  it('returns scoped recovery instead of an oversized incomplete cut', () => {
    const f = fixture()
    f.append({ type: 'fixture', text: 'x'.repeat(4 * 1024 * 1024) })
    const frame = handleTopicCatchUp({ afterSequence: '0', topics: f.topics }, f.ctx).result as SessionStreamFrame
    expect(frame.events).toEqual([])
    expect(frame.recover).toEqual(f.topics)
  })
  it('refuses invalid cursors, cross-environment topics and missing scopes before reading', () => {
    const f = fixture()
    const read = vi.spyOn(f.ctx.sessions, 'listEventsAfter')
    const p = { afterSequence: '0', topics: f.topics }
    expect(handleTopicCatchUp({ ...p, versions: { s: -1 } }, f.ctx).error?.code).toBe('invalid_argument')
    expect(handleTopicCatchUp({ ...p, topics: [{ ...f.topics[0], environmentId: 'other' }] }, f.ctx).error?.code).toBe('identity_conflict')
    f.ctx.client.scopes = []
    expect(handleTopicCatchUp(p, f.ctx).error?.code).toBe('forbidden')
    expect(read).not.toHaveBeenCalled()
  })
})
