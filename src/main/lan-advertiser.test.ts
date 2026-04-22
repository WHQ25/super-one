vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { Bonjour } from 'bonjour-service'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanAdvertiser, LAN_SERVICE_TYPE } from './lan-advertiser'

describe('LanAdvertiser', () => {
  let advertiser: LanAdvertiser | null = null
  let browserBonjour: Bonjour | null = null

  afterEach(() => {
    advertiser?.unpublish()
    advertiser = null
    browserBonjour?.destroy()
    browserBonjour = null
  })

  it('publishes a discoverable _superone._tcp service with roomId in TXT', async () => {
    advertiser = new LanAdvertiser()
    advertiser.publish({
      name: 'superone-test',
      port: 54321,
      txt: { roomId: 'room-abc-123', hostName: 'test-host' },
    })

    browserBonjour = new Bonjour()
    const found = await new Promise<{ port: number; txt: Record<string, unknown> } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000)
      browserBonjour!.find({ type: LAN_SERVICE_TYPE }, (service) => {
        if (service.name !== 'superone-test') return
        clearTimeout(timer)
        resolve({ port: service.port, txt: service.txt as Record<string, unknown> })
      })
    })

    expect(found).not.toBeNull()
    expect(found!.port).toBe(54321)
    expect(found!.txt.roomId).toBe('room-abc-123')
    expect(found!.txt.hostName).toBe('test-host')
  }, 10_000)

  it('stops broadcasting after unpublish', async () => {
    advertiser = new LanAdvertiser()
    advertiser.publish({
      name: 'superone-unpublish-test',
      port: 54322,
      txt: { roomId: 'room-unp-456' },
    })
    advertiser.unpublish()
    expect(advertiser.isPublishing()).toBe(false)
  })
})
