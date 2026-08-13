vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { describe, expect, it, vi } from 'vitest'
import {
  LanAdvertiser,
  LAN_SERVICE_FQDN,
  buildRecords,
  type AdvertiserStrategy,
  type LanAdvertisement,
} from './lan-advertiser'

function fakeStrategy(): AdvertiserStrategy & { ads: LanAdvertisement[]; publishCalls: number } {
  const ads: LanAdvertisement[] = []
  let publishing = false
  return {
    ads,
    publishCalls: 0,
    async publish(ad) {
      this.publishCalls += 1
      ads.push(ad)
      publishing = true
    },
    async unpublish() {
      publishing = false
    },
    isPublishing() {
      return publishing
    },
  }
}

describe('LanAdvertiser', () => {
  it('publishes name, port and TXT without touching the network', async () => {
    const strategy = fakeStrategy()
    const advertiser = new LanAdvertiser(strategy)
    await advertiser.publish({
      name: 'superone-test',
      port: 54321,
      txt: { roomId: 'room-abc-123', hostName: 'test-host' },
    })
    expect(strategy.publishCalls).toBe(1)
    expect(strategy.ads[0]).toEqual({
      name: 'superone-test',
      port: 54321,
      txt: { roomId: 'room-abc-123', hostName: 'test-host' },
    })
    expect(advertiser.isPublishing()).toBe(true)
  })

  it('does not advertise A or AAAA records (defers to system mDNSResponder)', () => {
    const records = buildRecords({
      name: 'superone-host-isolation',
      port: 54399,
      txt: { roomId: 'iso' },
    })
    expect(records.every((r) => r.type !== 'A' && r.type !== 'AAAA')).toBe(true)
    expect(records.map((r) => r.type).sort()).toEqual(['PTR', 'SRV', 'TXT'])
    expect(records.some((r) => r.name.includes(LAN_SERVICE_FQDN))).toBe(true)
  })

  it('stops broadcasting after unpublish', async () => {
    const strategy = fakeStrategy()
    const advertiser = new LanAdvertiser(strategy)
    await advertiser.publish({
      name: 'superone-unpublish-test',
      port: 54322,
      txt: { roomId: 'room-unp-456' },
    })
    expect(advertiser.isPublishing()).toBe(true)
    await advertiser.unpublish()
    expect(advertiser.isPublishing()).toBe(false)
  })

  it('publish() with identical config is a no-op (idempotent)', async () => {
    const strategy = fakeStrategy()
    const advertiser = new LanAdvertiser(strategy)
    const ad = {
      name: 'superone-idempotent',
      port: 54323,
      txt: { roomId: 'same' },
    }
    await advertiser.publish(ad)
    await advertiser.publish(ad)
    expect(strategy.publishCalls).toBe(1)
  })
})
