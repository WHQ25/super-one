import { describe, expect, it, vi } from 'vitest'
import { deferredPhoneConnection } from './deferred-phone-connection'
import type { PhoneConnection, PhoneLink } from './phone-endpoint'
const link = () => ({ close: vi.fn() }) as unknown as PhoneLink
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve))
describe('phone startup connection', () => {
  it('holds authenticated frames in order until the domain is ready', async () => {
    const receive = vi.fn(), close = vi.fn()
    let ready!: (connection: PhoneConnection) => void
    const pending = deferredPhoneConnection(link(), () => new Promise(resolve => { ready = resolve }))
    const first = new Uint8Array([1]); pending.receive(first); first[0] = 9
    pending.receive(new Uint8Array([2])); ready({ receive, close }); await tick()
    pending.receive(new Uint8Array([3]))
    expect(receive.mock.calls.map(([frame]) => [...frame])).toEqual([[1], [2], [3]])
    pending.close(); expect(close).toHaveBeenCalledTimes(1)
  })
  it('closes a late opened endpoint without replaying frames after its link left', async () => {
    const receive = vi.fn(), close = vi.fn()
    let ready!: (connection: PhoneConnection) => void
    const pending = deferredPhoneConnection(link(), () => new Promise(resolve => { ready = resolve }))
    pending.receive(new Uint8Array([1])); pending.close(); ready({ receive, close }); await tick()
    expect(receive).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1)
  })
  it('closes an overflowing or failed startup instead of losing frames silently', async () => {
    const overflow = link()
    deferredPhoneConnection(overflow, () => new Promise(() => {})).receive(new Uint8Array(4 * 1024 * 1024 + 1))
    expect(overflow.close).toHaveBeenCalledWith(1009, 'phone_startup_buffer_full')
    const failed = link(); deferredPhoneConnection(failed, async () => { throw new Error('database unavailable') })
    await tick(); await tick(); expect(failed.close).toHaveBeenCalledWith(1011, 'desktop_domain_unavailable')
  })
})
