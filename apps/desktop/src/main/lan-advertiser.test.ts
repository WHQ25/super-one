vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import makeMdns, { type MdnsAnswer, type MdnsPacket } from 'multicast-dns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanAdvertiser, LAN_SERVICE_FQDN } from './lan-advertiser'

const SERVICE_DOMAIN = `${LAN_SERVICE_FQDN}.local`

function decodeTxt(data: unknown): Record<string, string> {
  const buffers = Array.isArray(data) ? (data as Buffer[]) : []
  const result: Record<string, string> = {}
  for (const buf of buffers) {
    const entry = buf.toString('utf8')
    const eq = entry.indexOf('=')
    if (eq > 0) result[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return result
}

async function browse(serviceName: string, timeoutMs: number): Promise<{
  port?: number
  txt?: Record<string, string>
  target?: string
} | null> {
  const browser = makeMdns()
  const instance = `${serviceName}.${SERVICE_DOMAIN}`
  const found: { port?: number; txt?: Record<string, string>; target?: string } = {}

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      browser.destroy()
      resolve(null)
    }, timeoutMs)

    const tryResolve = (): void => {
      if (found.port !== undefined && found.txt !== undefined) {
        clearTimeout(timer)
        browser.destroy()
        resolve(found)
      }
    }

    const onResponse = (packet: MdnsPacket): void => {
      const records: MdnsAnswer[] = [
        ...(packet.answers ?? []),
        ...(packet.additionals ?? []),
      ]
      for (const r of records) {
        if (r.name.toLowerCase() === instance.toLowerCase()) {
          if (r.type === 'SRV') {
            const data = r.data as { port: number; target: string }
            found.port = data.port
            found.target = data.target
          } else if (r.type === 'TXT') {
            found.txt = decodeTxt(r.data)
          }
        }
      }
      tryResolve()
    }

    browser.on('response', onResponse)
    browser.once('ready', () => {
      browser.query({ questions: [{ name: SERVICE_DOMAIN, type: 'PTR' }] })
      browser.query({ questions: [{ name: instance, type: 'ANY' }] })
    })
  })
}

describe('LanAdvertiser', () => {
  let advertiser: LanAdvertiser | null = null

  afterEach(async () => {
    await advertiser?.unpublish()
    advertiser = null
  })

  it('publishes a discoverable _superone._tcp service with roomId in TXT', async () => {
    advertiser = new LanAdvertiser()
    await advertiser.publish({
      name: 'superone-test',
      port: 54321,
      txt: { roomId: 'room-abc-123', hostName: 'test-host' },
    })

    const found = await browse('superone-test', 4000)
    expect(found).not.toBeNull()
    expect(found!.port).toBe(54321)
    expect(found!.txt?.roomId).toBe('room-abc-123')
    expect(found!.txt?.hostName).toBe('test-host')
  }, 10_000)

  it('does not advertise A or AAAA records for the system hostname (defers to system mDNSResponder)', async () => {
    advertiser = new LanAdvertiser()
    await advertiser.publish({
      name: 'superone-host-isolation',
      port: 54399,
      txt: { roomId: 'iso' },
    })

    const browser = makeMdns()
    const instance = `superone-host-isolation.${SERVICE_DOMAIN}`
    const aaaaRecords: MdnsAnswer[] = []

    const result = await new Promise<MdnsAnswer[]>((resolve) => {
      const timer = setTimeout(() => {
        browser.destroy()
        resolve(aaaaRecords)
      }, 2000)

      browser.on('response', (packet) => {
        const records: MdnsAnswer[] = [
          ...(packet.answers ?? []),
          ...(packet.additionals ?? []),
        ]
        for (const r of records) {
          if ((r.type === 'A' || r.type === 'AAAA') && r.name.toLowerCase() === instance.toLowerCase()) {
            aaaaRecords.push(r)
            clearTimeout(timer)
            browser.destroy()
            resolve(aaaaRecords)
            return
          }
        }
      })
      browser.once('ready', () => {
        browser.query({ questions: [{ name: instance, type: 'ANY' }] })
      })
    })

    expect(result).toEqual([])
  }, 10_000)

  it('stops broadcasting after unpublish', async () => {
    advertiser = new LanAdvertiser()
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
    advertiser = new LanAdvertiser()
    const ad = {
      name: 'superone-idempotent',
      port: 54323,
      txt: { roomId: 'idem-1' },
    }
    await advertiser.publish(ad)
    expect(advertiser.isPublishing()).toBe(true)
    await advertiser.publish({ ...ad, txt: { ...ad.txt } })
    expect(advertiser.isPublishing()).toBe(true)
  })
})
