import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import { readCallerMailbox, resolveSendChannel } from './mailbox'
import { CollaborationStore } from './store'

let db: NodeDatabase
let store: CollaborationStore
const sessionTitle = (id: string) => id

beforeEach(() => {
  db = openNodeDatabase(':memory:')
  store = new CollaborationStore(db)
})

afterEach(() => {
  db.close()
})

function spawn(parent: string, child: string) {
  const grantId = store.createGrant({
    kind: 'spawn', parentSessionId: parent, agentId: 'claude-base', config: { launchId: `${parent}-${child}`, name: 'Ada', role: 'Dev' },
  })
  store.bindStartedSession(store.grantById(grantId)!, child, { name: 'Ada', role: 'Dev' })
  return grantId
}

function send(from: string, to: string | undefined, content: string, clientMessageId?: string) {
  const channel = resolveSendChannel(store, from, to, sessionTitle)
  return store.appendMessage({
    grantId: channel.grant.grant_id,
    senderSessionId: from,
    recipientSessionId: channel.peer.sessionId,
    content,
    ...(clientMessageId ? { clientMessageId } : {}),
  })
}

describe('continueSession', () => {
  it('moves a parent\'s channels, messages and cursors to its successor', () => {
    const grantId = spawn('parent', 'child')
    send('parent', 'child', 'start')
    send('child', undefined, 'first report')
    readCallerMailbox(store, 'parent', {}, sessionTitle)
    send('child', undefined, 'second report')

    const moved = store.continueSession('parent', 'parent2')

    expect(moved).toEqual([expect.objectContaining({ grant_id: grantId, parent_session_id: 'parent2', child_session_id: 'child' })])
    expect(store.channelsFor('parent')).toEqual([])
    // Only the report the old session never read is still unread.
    const read = readCallerMailbox(store, 'parent2', {}, sessionTitle)
    expect(read.messages.map((message) => message.content)).toEqual(['second report'])
    expect(store.lastMessageTimes('parent').sentAt).toBeNull()
    expect(store.lastMessageTimes('parent2').sentAt).not.toBeNull()
  })

  it('makes the successor the spawn child, so the parent reaches it and it reaches the parent', () => {
    spawn('parent', 'child')
    store.continueSession('child', 'child2')

    expect(store.isSpawnChild('child')).toBe(false)
    expect(store.spawnGrantForChild('child2')?.parent_session_id).toBe('parent')
    expect(resolveSendChannel(store, 'child2', undefined, sessionTitle).peer.sessionId).toBe('parent')
    expect(resolveSendChannel(store, 'parent', 'child2', sessionTitle).peer.sessionId).toBe('child2')
  })

  it('keeps idempotency keys working for the successor', () => {
    spawn('parent', 'child')
    const first = send('child', undefined, 'report', 'client-1')
    store.continueSession('child', 'child2')

    const retried = send('child2', undefined, 'report', 'client-1')

    expect(retried).toEqual({ row: expect.objectContaining({ id: first.row.id }), reused: true })
  })

  it('leaves handoff and unstarted grants with the old session', () => {
    const handoff = store.createGrant({ kind: 'handoff', parentSessionId: 'parent', agentId: 'claude-base', config: { launchId: 'h' } })
    const unstarted = store.createGrant({ kind: 'spawn', parentSessionId: 'parent', agentId: 'claude-base', config: { launchId: 'u' } })

    expect(store.continueSession('parent', 'parent2')).toEqual([])
    expect(store.grantForLaunch('parent', 'h')?.grant_id).toBe(handoff)
    expect(store.grantForLaunch('parent', 'u')?.grant_id).toBe(unstarted)
  })

  it('moves a started link from either side and leaves an unstarted one', () => {
    const started = store.createGrant({ kind: 'link', parentSessionId: 'a', childSessionId: 'b', agentId: '', config: { launchId: 'l1' } })
    store.markStarted(started)
    const pending = store.createGrant({ kind: 'link', parentSessionId: 'c', childSessionId: 'b', agentId: '', config: { launchId: 'l2' } })

    store.continueSession('b', 'b2')

    expect(store.grantById(started)?.child_session_id).toBe('b2')
    expect(store.grantById(pending)?.child_session_id).toBe('b')
  })

  it('refuses a second continuation of the same session', () => {
    store.continueSession('a', 'b')
    expect(() => store.continueSession('a', 'c')).toThrow(/already continued in b/)
  })
})

describe('continuation chain', () => {
  it('resolves an old id to the newest session', () => {
    store.continueSession('a', 'b')
    store.continueSession('b', 'c')

    expect(store.successorOf('a')).toBe('b')
    expect(store.predecessorOf('c')).toBe('b')
    expect(store.currentSessionFor('a')).toBe('c')
    expect(store.currentSessionFor('z')).toBe('z')
  })

  it('redirects `to` and `from` that still name a continued peer', () => {
    spawn('parent', 'child')
    store.continueSession('parent', 'parent2')
    store.continueSession('parent2', 'parent3')

    // The child's prompt still names the first parent.
    expect(resolveSendChannel(store, 'child', 'parent', sessionTitle).peer.sessionId).toBe('parent3')
    send('parent3', 'child', 'hello')
    store.continueSession('child', 'child2')
    expect(readCallerMailbox(store, 'child2', { from: ['parent'] }, sessionTitle).messages.map((m) => m.content)).toEqual(['hello'])
  })
})
