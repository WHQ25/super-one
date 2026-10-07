import { beforeEach, describe, expect, it, vi } from 'vitest'

const { info } = vi.hoisted(() => ({ info: vi.fn() }))
vi.mock('../logger', () => ({ mobileLog: () => ({ info }) }))

import { appendMobileLog } from './mobile-log'

describe('appendMobileLog', () => {
  beforeEach(() => { info.mockReset() })

  it('writes one line per entry, stamped with the phone clock and device', () => {
    const written = appendMobileLog('phone-1234567890', [
      { at: '2026-10-08T01:00:00.000Z', tag: 'connection', fields: { step: 'foreground', healthy: true, epoch: 3, transport: null } },
    ])
    expect(written).toBe(1)
    expect(info).toHaveBeenCalledWith('[2026-10-08T01:00:00.000Z] [phone-12] connection step="foreground" healthy=true epoch=3 transport=null')
  })

  it('cannot forge a second line or smuggle structured values', () => {
    appendMobileLog('phone', [{ at: '2026-10-08T01:00:00Z', tag: 'sidebar', fields: { reason: 'a\n[forged] line', nested: { x: 1 }, 'bad key': 1 } }])
    expect(info).toHaveBeenCalledWith('[2026-10-08T01:00:00.000Z] [phone] sidebar reason="a [forged] line"')
  })

  it('drops malformed entries instead of failing the batch', () => {
    const written = appendMobileLog('phone', [null, { at: 'yesterday', tag: 'x' }, { at: '2026-10-08T01:00:00Z', tag: 'has space' }, { at: '2026-10-08T01:00:00Z', tag: 'ok' }])
    expect(written).toBe(1)
    expect(appendMobileLog('phone', 'not a list')).toBe(0)
  })
})
