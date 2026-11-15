import { describe, expect, it } from 'vitest'
import { ChromeBridgeHub } from './chrome-bridge-hub'

describe('chrome bridge connection', () => {
  it('reports a live host once, including when a new host replaces it', () => {
    const hub = new ChromeBridgeHub()
    const seen: boolean[] = []
    hub.onConnection((connected) => seen.push(connected))
    hub.attach(() => {})
    hub.detach('closed')
    hub.attach(() => {})
    hub.attach(() => {})
    expect(seen).toEqual([true, false, true, true])
    expect(hub.connected).toBe(true)
    expect(hub.browsers()).toEqual(['chrome'])
  })

  it('keeps each browser and ignores a replaced socket closing', async () => {
    const hub = new ChromeBridgeHub()
    const seen: boolean[] = []
    hub.onConnection((connected) => seen.push(connected))
    const edge = hub.attach((json) => {
      const request = JSON.parse(json) as { id: number }
      hub.receive(JSON.stringify({ id: request.id, result: { tabs: [] } }), 'edge')
    }, 'edge')
    const chrome = hub.attach(() => {}, 'chrome')
    const replaced = hub.attach(() => {}, 'chrome')
    hub.detachBrowser('chrome', 'old socket', chrome)
    expect(hub.browsers()).toEqual(['chrome', 'edge'])
    expect(hub.connected).toBe(true)
    await expect(hub.call('tabs.list', {})).rejects.toThrow(/More than one/)
    await expect(hub.call('tabs.list', {}, { browserId: 'edge' })).resolves.toEqual({ tabs: [] })
    hub.detachBrowser('edge', 'closed', edge)
    expect(hub.browsers()).toEqual(['chrome'])
    expect(seen.at(-1)).toBe(true)
    hub.detachBrowser('chrome', 'closed', replaced)
    expect(hub.connected).toBe(false)
    expect(seen.at(-1)).toBe(false)
  })
})
