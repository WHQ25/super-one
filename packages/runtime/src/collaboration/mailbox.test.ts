import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import {
  assertNotPeeredElsewhere,
  readCallerMailbox,
  resolveSendChannel,
} from './mailbox'
import { CollaborationStore } from './store'
import { HANDOFF_NO_MAILBOX } from './text'

let db: NodeDatabase
let store: CollaborationStore
const titles: Record<string, string> = { parent: 'Parent task', peer: 'Existing review' }
const sessionTitle = (id: string) => titles[id] ?? null

beforeEach(() => {
  db = openNodeDatabase(':memory:')
  store = new CollaborationStore(db)
})

afterEach(() => {
  db.close()
})

function spawn(parent: string, child: string, name = 'Ada', role = 'Dev') {
  const grantId = store.createGrant({
    kind: 'spawn', parentSessionId: parent, agentId: 'claude-base', config: { launchId: `${parent}-${child}`, name, role },
  })
  store.bindStartedSession(store.grantById(grantId)!, child, { name, role })
  return grantId
}

function link(initiator: string, peer: string, started = true) {
  const grantId = store.createGrant({
    kind: 'link', parentSessionId: initiator, childSessionId: peer, agentId: '',
    config: { launchId: `${initiator}-${peer}`, name: 'Peer', role: 'Peer' },
  })
  if (started) store.markStarted(grantId)
  return grantId
}

function send(from: string, to: string | undefined, content: string) {
  const channel = resolveSendChannel(store, from, to, sessionTitle)
  store.appendMessage({
    grantId: channel.grant.grant_id,
    senderSessionId: from,
    recipientSessionId: channel.peer.sessionId,
    content,
  })
  return channel
}

describe('resolveSendChannel', () => {
  it('lets a spawn child reach its parent without naming it', () => {
    spawn('parent', 'child')
    const channel = send('child', undefined, 'done')
    expect(channel.peer).toMatchObject({ sessionId: 'parent', relation: 'parent', title: 'Parent task' })
  })

  it('requires `to` once the caller has several peers and lists them', () => {
    spawn('parent', 'child-a', 'Ada')
    spawn('parent', 'child-b', 'Bo')
    expect(() => resolveSendChannel(store, 'parent', undefined, sessionTitle))
      .toThrow(/child-a .*child-b/)
    expect(send('parent', 'child-b', 'hi').peer).toMatchObject({ sessionId: 'child-b', name: 'Bo', relation: 'child' })
  })

  it('opens a link channel only once the link is started, for both sides', () => {
    const grantId = link('parent', 'peer', false)
    expect(() => resolveSendChannel(store, 'parent', 'peer', sessionTitle)).toThrow(/not one of your collaboration peers/)
    store.markStarted(grantId)
    expect(send('parent', 'peer', 'hi').peer.relation).toBe('link')
    expect(send('peer', undefined, 'yo').peer).toMatchObject({ sessionId: 'parent', relation: 'link', title: 'Parent task' })
  })

  it('lets several sessions link the same peer, each over its own channel', () => {
    link('lead-a', 'peer')
    link('lead-b', 'peer')
    expect(send('lead-a', 'peer', 'from a').peer.sessionId).toBe('peer')
    expect(send('lead-b', 'peer', 'from b').peer.sessionId).toBe('peer')
    expect(() => resolveSendChannel(store, 'peer', undefined, sessionTitle)).toThrow(/lead-a .*lead-b/)
    expect(send('peer', 'lead-b', 'to b').grant.parent_session_id).toBe('lead-b')
  })

  it('keeps the parent as a linked spawn child\'s default recipient', () => {
    spawn('parent', 'child')
    link('lead', 'child')
    expect(send('child', undefined, 'done').peer).toMatchObject({ sessionId: 'parent', relation: 'parent' })
    expect(send('child', 'lead', 'answer').peer).toMatchObject({ sessionId: 'lead', relation: 'link' })
    expect(send('lead', 'child', 'question').peer.relation).toBe('link')
  })

  it('explains that a handoff has no mailbox', () => {
    const grantId = store.createGrant({
      kind: 'handoff', parentSessionId: 'parent', agentId: 'claude-base', config: { launchId: 'h' },
    })
    store.bindStartedSession(store.grantById(grantId)!, 'sibling', {})
    expect(() => resolveSendChannel(store, 'parent', 'sibling', sessionTitle)).toThrow(HANDOFF_NO_MAILBOX)
    expect(() => resolveSendChannel(store, 'sibling', 'parent', sessionTitle)).toThrow(HANDOFF_NO_MAILBOX)
  })

  it('refuses a stranger and names the real peers', () => {
    spawn('parent', 'child')
    expect(() => resolveSendChannel(store, 'parent', 'stranger', sessionTitle))
      .toThrow(/stranger is not one of your collaboration peers\. Your peers: child/)
    expect(() => resolveSendChannel(store, 'loner', undefined, sessionTitle)).toThrow(/no collaboration peers/)
  })
})

describe('readCallerMailbox', () => {
  it('drains every peer and always lists peers', () => {
    spawn('parent', 'child')
    link('parent', 'peer')
    send('child', undefined, 'from child')
    send('peer', 'parent', 'from peer')

    const first = readCallerMailbox(store, 'parent', {}, sessionTitle)
    expect(first.messages.map((m) => [m.fromSessionId, m.from.relation, m.content])).toEqual([
      ['child', 'child', 'from child'],
      ['peer', 'link', 'from peer'],
    ])
    expect(first.peers.map((p) => p.sessionId)).toEqual(['child', 'peer'])

    const again = readCallerMailbox(store, 'parent', {}, sessionTitle)
    expect(again.messages).toEqual([])
    expect(again.peers).toHaveLength(2)
  })

  it('reads only the requested peers and leaves the rest unread', () => {
    spawn('parent', 'child')
    link('parent', 'peer')
    send('child', undefined, 'from child')
    send('peer', 'parent', 'from peer')

    expect(readCallerMailbox(store, 'parent', { from: ['peer'] }, sessionTitle).messages.map((m) => m.content))
      .toEqual(['from peer'])
    expect(readCallerMailbox(store, 'parent', {}, sessionTitle).messages.map((m) => m.content))
      .toEqual(['from child'])
    expect(() => readCallerMailbox(store, 'parent', { from: ['stranger'] }, sessionTitle))
      .toThrow(/Not your collaboration peers: stranger/)
  })
})

describe('assertNotPeeredElsewhere', () => {
  it('rejects a second channel to an existing peer but keeps own links re-requestable', () => {
    link('peer', 'parent')
    expect(() => assertNotPeeredElsewhere(store, 'parent', 'peer')).toThrow(/already one of your collaboration peers/)
    link('other', 'target')
    expect(() => assertNotPeeredElsewhere(store, 'other', 'target')).not.toThrow()
  })
})
