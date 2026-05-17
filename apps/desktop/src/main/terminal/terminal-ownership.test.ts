import { describe, it, expect, vi } from 'vitest'
import { TerminalOwnership } from './terminal-ownership'

describe('TerminalOwnership write token', () => {
  it('defaults to local writer with no remote owner', () => {
    const o = new TerminalOwnership()
    expect(o.owner).toEqual({ kind: 'local' })
    expect(o.ownerDeviceId).toBeNull()
    expect(o.isWritableBy('local')).toBe(true)
    expect(o.isWritableBy('phone-1')).toBe(false)
  })

  it('remote claim takes the writer from local and flips writability', () => {
    const o = new TerminalOwnership()
    expect(o.claim('phone-1')).toEqual({ ok: true })
    expect(o.ownerDeviceId).toBe('phone-1')
    expect(o.isWritableBy('phone-1')).toBe(true)
    expect(o.isWritableBy('local')).toBe(false)
  })

  it('rejects a second remote claim while owned by another remote', () => {
    const o = new TerminalOwnership()
    o.claim('phone-1')
    expect(o.claim('phone-2')).toEqual({ ok: false, code: 'already_claimed' })
    expect(o.ownerDeviceId).toBe('phone-1')
  })

  it('treats a re-claim by the current owner as idempotent ok', () => {
    const o = new TerminalOwnership()
    o.claim('phone-1')
    expect(o.claim('phone-1')).toEqual({ ok: true })
    expect(o.ownerDeviceId).toBe('phone-1')
  })

  it('local reclaim pre-empts the remote owner', () => {
    const o = new TerminalOwnership()
    o.claim('phone-1')
    o.reclaimLocal()
    expect(o.owner).toEqual({ kind: 'local' })
    expect(o.isWritableBy('local')).toBe(true)
    expect(o.isWritableBy('phone-1')).toBe(false)
  })

  it('release by the owning device falls back to local; release by a non-owner is a no-op', () => {
    const o = new TerminalOwnership()
    o.claim('phone-1')
    o.release('phone-2')
    expect(o.ownerDeviceId).toBe('phone-1')
    o.release('phone-1')
    expect(o.owner).toEqual({ kind: 'local' })
  })
})

describe('TerminalOwnership read-only subscribers', () => {
  it('allows N subscribers with no ownership conflict', () => {
    const o = new TerminalOwnership()
    o.subscribe('a')
    o.subscribe('b')
    o.subscribe('c')
    expect(o.subscriberCount).toBe(3)
    expect(o.isWritableBy('a')).toBe(false)
    expect(o.owner).toEqual({ kind: 'local' })
  })

  it('a subscriber that later claims becomes the sole writer; others stay read-only', () => {
    const o = new TerminalOwnership()
    o.subscribe('a')
    o.subscribe('b')
    o.claim('a')
    expect(o.isWritableBy('a')).toBe(true)
    expect(o.isWritableBy('b')).toBe(false)
    expect(o.subscriberCount).toBe(2)
  })
})

describe('TerminalOwnership device disconnect', () => {
  it('releases the writer and removes the subscription on disconnect', () => {
    const o = new TerminalOwnership()
    o.subscribe('phone-1')
    o.claim('phone-1')
    o.handleDeviceDisconnected('phone-1')
    expect(o.owner).toEqual({ kind: 'local' })
    expect(o.subscriberCount).toBe(0)
  })
})

describe('TerminalOwnership change notification', () => {
  it('emits only on actual owner change', () => {
    const o = new TerminalOwnership()
    const cb = vi.fn()
    o.onChange(cb)
    o.subscribe('a')
    expect(cb).not.toHaveBeenCalled()
    o.claim('a')
    o.claim('a')
    o.reclaimLocal()
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
