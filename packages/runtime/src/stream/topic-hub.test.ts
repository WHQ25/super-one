import { describe, expect, it, vi } from 'vitest'
import type { TopicRef } from '@superone/shared/environment/topics'
import { TopicHub } from './topic-hub'

const session = (sessionId: string, environmentId = 'env-b'): TopicRef => ({ kind: 'session', environmentId, sessionId })
const terminal = (terminalId: string): TopicRef => ({ kind: 'terminal', environmentId: 'env-b', terminalId })
const list: TopicRef = { kind: 'sessionList', environmentId: 'env-b' }

function recorder() {
  const items: Array<{ topic: TopicRef; item: string }> = []
  return { items, sink: { deliver: (topic: TopicRef, item: string) => { items.push({ topic, item }) } } }
}

describe('TopicHub', () => {
  it('delivers each topic only to the connections subscribed to it', () => {
    const hub = new TopicHub<string>()
    const window = recorder()
    const desktopA = recorder()
    const phoneC = recorder()
    hub.open({ id: 'window', policy: null, sink: window.sink }).subscribe(session('s1'))
    hub.open({ id: 'a', policy: null, sink: desktopA.sink }).subscribe(list)
    hub.open({ id: 'c', policy: null, sink: phoneC.sink }).subscribe(terminal('t3'))

    hub.publish(session('s1'), 'turn')
    hub.publish(list, 'renamed')
    hub.publish(terminal('t3'), 'output')
    hub.publish(session('s2'), 'other')

    expect(window.items.map((d) => d.item)).toEqual(['turn'])
    expect(desktopA.items.map((d) => d.item)).toEqual(['renamed'])
    expect(phoneC.items.map((d) => d.item)).toEqual(['output'])
  })

  it('reaches wildcard subscribers of a kind in the same environment only', () => {
    const hub = new TopicHub<string>()
    const all = recorder()
    hub.open({ id: 'renderer', policy: null, sink: all.sink }).subscribe(session('*'))
    hub.publish(session('s1'), 'one')
    hub.publish(session('s2'), 'two')
    hub.publish(session('s1', 'env-other'), 'elsewhere')
    hub.publish(terminal('t1'), 'not a session')
    expect(all.items.map((d) => d.item)).toEqual(['one', 'two'])
  })

  it('does not deliver twice to a connection holding both the topic and its wildcard', () => {
    const hub = new TopicHub<string>()
    const both = recorder()
    const connection = hub.open({ id: 'x', policy: null, sink: both.sink })
    connection.subscribe(session('s1'))
    connection.subscribe(session('*'))
    expect(hub.publish(session('s1'), 'once')).toEqual(['x'])
    expect(both.items).toHaveLength(1)
  })

  it('delivers once per group with the members reached', () => {
    const hub = new TopicHub<string>()
    const group = { deliver: vi.fn() }
    hub.open({ id: 'phone-1', policy: null, sink: { group } }).subscribe(session('s1'))
    hub.open({ id: 'phone-2', policy: null, sink: { group } }).subscribe(session('s1'))
    hub.open({ id: 'phone-3', policy: null, sink: { group } }).subscribe(session('s2'))
    hub.publish(session('s1'), 'turn')
    expect(group.deliver).toHaveBeenCalledTimes(1)
    expect(group.deliver).toHaveBeenCalledWith(session('s1'), 'turn', ['phone-1', 'phone-2'])
  })

  it('reports interest when a topic gains its first and loses its last subscriber', () => {
    const hub = new TopicHub<string>()
    const changes: Array<[string, boolean]> = []
    hub.onInterest((topic, interested) => changes.push([topic.kind === 'session' ? topic.sessionId : topic.kind, interested]))
    const a = hub.open({ id: 'a', policy: null, sink: recorder().sink })
    const b = hub.open({ id: 'b', policy: null, sink: recorder().sink })
    a.subscribe(session('s1'))
    b.subscribe(session('s1'))
    a.unsubscribe(session('s1'))
    expect(hub.interest()).toEqual([{ topic: session('s1'), connections: 1 }])
    b.close()
    expect(changes).toEqual([['s1', true], ['s1', false]])
    expect(hub.interest()).toEqual([])
  })

  it('replaces one kind of subscription without touching the others', () => {
    const hub = new TopicHub<string>()
    const connection = hub.open({ id: 'renderer', policy: null, sink: recorder().sink })
    connection.subscribe(list)
    connection.replace('session', [session('s1'), session('s2')])
    connection.replace('session', [session('s2'), session('s3')])
    expect(connection.topics()).toEqual([list, session('s2'), session('s3')])
  })

  it('switches policy in place and drops a closed connection', () => {
    const hub = new TopicHub<string, { tier: string }>()
    const sink = recorder()
    const connection = hub.open({ id: 'a', policy: { tier: 'lan' }, sink: sink.sink })
    connection.subscribe(session('s1'))
    connection.setPolicy({ tier: 'relay' })
    expect(hub.get('a')?.policy).toEqual({ tier: 'relay' })
    connection.close()
    connection.subscribe(session('s1'))
    expect(hub.publish(session('s1'), 'gone')).toEqual([])
    expect(hub.get('a')).toBeUndefined()
  })

  it('keeps delivering to other connections when a sink throws', () => {
    const onSinkError = vi.fn()
    const hub = new TopicHub<string>({ onSinkError })
    const ok = recorder()
    hub.open({ id: 'bad', policy: null, sink: { deliver: () => { throw new Error('boom') } } }).subscribe(list)
    hub.open({ id: 'ok', policy: null, sink: ok.sink }).subscribe(list)
    hub.publish(list, 'changed')
    expect(ok.items).toHaveLength(1)
    expect(onSinkError).toHaveBeenCalledWith('bad', list, expect.any(Error))
  })
})
