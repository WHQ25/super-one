import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import { topicKey, type TopicRef } from '@superone/shared/environment/topics'
import { createDesktopTopicHub, type DesktopTopicItem } from '../stream/desktop-topics'
import { PhoneTopics } from './phone-topics'
import { TerminalOwnership } from '../terminal/terminal-ownership'
import type { Session, SessionLifecycleEvent, SessionOwner } from '../session/types'

const LOCAL = 'env-local'
const s1: TopicRef = { kind: 'session', environmentId: LOCAL, sessionId: 's1' }

function fakeSession() {
  const listeners = new Set<(event: SessionLifecycleEvent) => void>()
  const subscribers = new Set<string>()
  let owner: SessionOwner = { kind: 'local' }
  const session = {
    id: 's1',
    get subscribers() { return subscribers },
    get owner() { return owner },
    onLifecycle: (listener: (event: SessionLifecycleEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  } as unknown as Session
  const emit = (event: SessionLifecycleEvent) => { for (const listener of listeners) listener(event) }
  return {
    session,
    subscribe: (deviceId: string) => { subscribers.add(deviceId); emit({ type: 'subscriber_added', sessionId: 's1', deviceId }) },
    unsubscribe: (deviceId: string) => { subscribers.delete(deviceId); emit({ type: 'subscriber_removed', sessionId: 's1', deviceId }) },
    claim: (deviceId: string) => { const previous = owner; owner = { kind: 'remote', deviceId }; emit({ type: 'owner_changed', sessionId: 's1', previous, current: owner }) },
    release: () => { const previous = owner; owner = { kind: 'local' }; emit({ type: 'owner_changed', sessionId: 's1', previous, current: owner }) },
  }
}

function setup() {
  const topics = createDesktopTopicHub()
  const deliveries: Array<{ topic: string; type: string; ids: readonly string[] }> = []
  const group = { deliver: (topic: TopicRef, item: DesktopTopicItem, ids: readonly string[]) => { deliveries.push({ topic: topicKey(topic), type: item.event.type, ids }) } }
  return { topics, deliveries, phones: new PhoneTopics(topics, group, LOCAL) }
}

describe('PhoneTopics', () => {
  it('gives every online phone the lists and environment notices, once per publish', () => {
    const { topics, deliveries, phones } = setup()
    phones.online('a', 'lan')
    phones.online('b', 'relay')
    topics.publish({ kind: 'sessionList', environmentId: LOCAL }, { kind: 'agent', event: { type: 'session_list_changed', projectPath: '/p' } })
    expect(deliveries).toEqual([{ topic: 'sessionList:env-local', type: 'session_list_changed', ids: ['a', 'b'] }])
    expect(topics.get('a')?.policy).toEqual({ tier: 'lan', surface: 'phone' })
    phones.online('a', 'relay')
    expect(topics.get('a')?.policy).toEqual({ tier: 'relay', surface: 'phone' })
    phones.offline('b')
    expect(topics.subscribers({ kind: 'drafts', environmentId: LOCAL })).toEqual(['a'])
  })

  it('follows a session while the phone subscribes to or holds it', () => {
    const { topics, phones } = setup()
    const fake = fakeSession()
    phones.online('a', 'relay')
    phones.watchSession(fake.session)
    fake.subscribe('a')
    expect(topics.subscribers(s1)).toEqual(['a'])
    fake.claim('a')
    fake.unsubscribe('a')
    expect(topics.subscribers(s1)).toEqual(['a'])
    fake.release()
    expect(topics.subscribers(s1)).toEqual([])
  })

  it('follows a terminal while the phone watches or writes it, with the owner change reaching the new owner', () => {
    const { topics, deliveries, phones } = setup()
    const ownership = new TerminalOwnership()
    const t1: TopicRef = { kind: 'terminal', environmentId: LOCAL, terminalId: 't1' }
    phones.online('a', 'relay')
    phones.online('b', 'relay')
    phones.watchTerminal('t1', ownership)
    ownership.onChange(() => topics.publish(t1, { kind: 'terminal', event: { type: 'terminal_owner_changed', terminalId: 't1', ownerDeviceId: 'b', writableByMe: false } }))
    ownership.subscribe('a')
    expect(topics.subscribers(t1)).toEqual(['a'])
    ownership.claim('b')
    expect(deliveries.at(-1)?.ids).toEqual(['a', 'b'])
    ownership.handleDeviceDisconnected('a')
    expect(topics.subscribers(t1)).toEqual(['b'])
  })
})
