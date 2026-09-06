import { describe, expect, it } from 'vitest'
import { LanServiceCache, collectLanServices, pickHost } from './lan-service-cache'

const record = (over: Partial<Parameters<typeof collectLanServices>[0][number]> = {}) => ({
  host: 'desk.local',
  port: 9000,
  addresses: ['192.168.1.9'],
  txt: { roomId: 'room-a', hostName: 'Desk' },
  ...over,
})

describe('resolving a Bonjour record', () => {
  it('prefers an IPv4 address over IPv6 and over the .local hostname', () => {
    expect(pickHost(record({ addresses: ['fe80::1', '192.168.1.9'] }))).toBe('192.168.1.9')
  })

  it('falls back to the first address, then to the hostname', () => {
    expect(pickHost(record({ addresses: ['fe80::1'] }))).toBe('fe80::1')
    expect(pickHost(record({ addresses: [] }))).toBe('desk.local')
    expect(pickHost(record({ addresses: null, host: null }))).toBeNull()
  })

  it('carries the advertised host label through for display', () => {
    expect(collectLanServices([record()])[0]).toEqual({
      roomId: 'room-a',
      host: '192.168.1.9',
      port: 9000,
      hostName: 'Desk',
    })
  })

  it('drops records that cannot be matched or dialled', () => {
    const dropped = collectLanServices([
      record({ txt: { hostName: 'No room id' } }),
      record({ port: null }),
      record({ port: 0 }),
      record({ addresses: [], host: null }),
    ])
    expect(dropped).toEqual([])
  })
})

describe('LAN service cache', () => {
  it('reports a change the first time a room appears', () => {
    const cache = new LanServiceCache()
    expect(cache.replace([record()])).toBe(true)
    expect(cache.lookup('room-a')).toMatchObject({ host: '192.168.1.9', port: 9000 })
  })

  it('stays quiet when the browser re-reports the same services', () => {
    const cache = new LanServiceCache()
    cache.replace([record()])
    expect(cache.replace([record()])).toBe(false)
  })

  it('reports a change when a desktop moves to a new address or port', () => {
    const cache = new LanServiceCache()
    cache.replace([record()])
    expect(cache.replace([record({ addresses: ['192.168.1.22'] })])).toBe(true)
    expect(cache.lookup('room-a')?.host).toBe('192.168.1.22')
  })

  it('reports a change when a desktop stops advertising', () => {
    const cache = new LanServiceCache()
    cache.replace([record()])
    expect(cache.replace([])).toBe(true)
    expect(cache.lookup('room-a')).toBeNull()
  })

  it('keeps one entry per room when a desktop is seen on several interfaces', () => {
    const cache = new LanServiceCache()
    cache.replace([record(), record({ addresses: ['192.168.1.10'] })])
    expect(cache.size).toBe(1)
  })

  it('treats an unparseable record as an absent one', () => {
    const cache = new LanServiceCache()
    cache.replace([record()])
    expect(cache.replace([record({ txt: null })])).toBe(true)
    expect(cache.list()).toEqual([])
  })
})
