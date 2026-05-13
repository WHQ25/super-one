import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  subscribePeer,
  emitPeer,
  clearPeerBus,
  _resetAllForTests,
} from './miniapp-peer-bus'

beforeEach(() => {
  _resetAllForTests()
})

describe('miniapp-peer-bus', () => {
  it('delivers event to single subscriber', () => {
    const listener = vi.fn()
    subscribePeer('s1', 'appA', listener)
    emitPeer('s1', 'appA', 'progress', { pct: 50 })
    expect(listener).toHaveBeenCalledWith('progress', { pct: 50 })
  })

  it('broadcasts to all subscribers in same (session, app)', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribePeer('s1', 'appA', a)
    subscribePeer('s1', 'appA', b)
    emitPeer('s1', 'appA', 'done', { ok: true })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('isolates events between different appIds in same session', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribePeer('s1', 'appA', a)
    subscribePeer('s1', 'appB', b)
    emitPeer('s1', 'appA', 'evt', { from: 'A' })
    expect(a).toHaveBeenCalledWith('evt', { from: 'A' })
    expect(b).not.toHaveBeenCalled()
  })

  it('isolates events between different sessions for same appId', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribePeer('s1', 'appA', a)
    subscribePeer('s2', 'appA', b)
    emitPeer('s1', 'appA', 'evt', null)
    expect(a).toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })

  it('unsubscribe stops delivery', () => {
    const listener = vi.fn()
    const unsub = subscribePeer('s1', 'appA', listener)
    emitPeer('s1', 'appA', 'one', {})
    unsub()
    emitPeer('s1', 'appA', 'two', {})
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('one', {})
  })

  it('emit with no subscribers is a no-op', () => {
    expect(() => emitPeer('s1', 'appA', 'evt', {})).not.toThrow()
  })

  it('one subscriber throwing does not block others', () => {
    const bad = vi.fn(() => { throw new Error('bad') })
    const good = vi.fn()
    subscribePeer('s1', 'appA', bad)
    subscribePeer('s1', 'appA', good)
    emitPeer('s1', 'appA', 'evt', null)
    expect(good).toHaveBeenCalled()
  })

  it('clearPeerBus drops all subscribers for (session, app)', () => {
    const listener = vi.fn()
    subscribePeer('s1', 'appA', listener)
    clearPeerBus('s1', 'appA')
    emitPeer('s1', 'appA', 'evt', null)
    expect(listener).not.toHaveBeenCalled()
  })

  it('clearPeerBus only affects the specified pair', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribePeer('s1', 'appA', a)
    subscribePeer('s1', 'appB', b)
    clearPeerBus('s1', 'appA')
    emitPeer('s1', 'appB', 'evt', null)
    expect(b).toHaveBeenCalled()
  })

  it('same listener subscribed twice receives once (Set dedup)', () => {
    const listener = vi.fn()
    subscribePeer('s1', 'appA', listener)
    subscribePeer('s1', 'appA', listener)
    emitPeer('s1', 'appA', 'evt', null)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
