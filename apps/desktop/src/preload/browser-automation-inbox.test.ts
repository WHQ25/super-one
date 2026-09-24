import { describe, expect, it, vi } from 'vitest'
import { createAutomationCallInbox, type BrowserAutomationCall } from './browser-automation-inbox'

const call = (callId: string, op = 'open', input: unknown = {}): BrowserAutomationCall => ({ callId, sessionId: 'session-a', op, input })

describe('createAutomationCallInbox', () => {
  it('hands calls that arrived before the host subscribed to it, in order', () => {
    const inbox = createAutomationCallInbox()
    inbox.deliver(call('c1'))
    inbox.deliver(call('c2', 'snapshot'))
    const host = vi.fn()

    inbox.subscribe(host)

    expect(host.mock.calls.map(([c]) => c.callId)).toEqual(['c1', 'c2'])
    inbox.deliver(call('c3'))
    expect(host).toHaveBeenLastCalledWith(call('c3'))
  })

  it('drops a held call that main cancelled before the host subscribed', () => {
    const inbox = createAutomationCallInbox()
    inbox.deliver(call('c1'))
    inbox.deliver(call('c2'))
    inbox.deliver(call('x1', 'cancel', { callId: 'c1' }))
    const host = vi.fn()

    inbox.subscribe(host)

    expect(host.mock.calls.map(([c]) => c.callId)).toEqual(['c2'])
  })

  it('holds calls across a host remount and keeps a cancel meant for a call still running', () => {
    const inbox = createAutomationCallInbox()
    const first = vi.fn()
    const unsubscribe = inbox.subscribe(first)
    inbox.deliver(call('c1'))
    unsubscribe()

    inbox.deliver(call('x1', 'cancel', { callId: 'c1' }))
    inbox.deliver(call('c2'))
    const second = vi.fn()
    inbox.subscribe(second)

    expect(first.mock.calls.map(([c]) => c.callId)).toEqual(['c1'])
    expect(second.mock.calls.map(([c]) => [c.callId, c.op])).toEqual([['x1', 'cancel'], ['c2', 'open']])
  })

  it('ignores a stale unsubscribe from a host that was already replaced', () => {
    const inbox = createAutomationCallInbox()
    const unsubscribeOld = inbox.subscribe(vi.fn())
    const current = vi.fn()
    inbox.subscribe(current)

    unsubscribeOld()
    inbox.deliver(call('c1'))

    expect(current).toHaveBeenCalledWith(call('c1'))
  })
})
