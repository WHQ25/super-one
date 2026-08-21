import { describe, expect, it } from 'vitest'
import { loadPairings, memoryKv, parsePairings, savePairings, upsertPairing } from './pairings'

describe('pairings persist', () => {
  it('drops corrupt JSON and incomplete rows', () => {
    expect(parsePairings('not-json')).toEqual([])
    expect(parsePairings(JSON.stringify([{ relayUrl: 'wss://x' }]))).toEqual([])
  })

  it('round-trips through a Kv', async () => {
    const kv = memoryKv()
    const row = { id: 'd1', relayUrl: 'wss://r', secret: 'ab'.repeat(32), hostName: 'Mac', lan: '10.0.0.2:7788' }
    await savePairings(kv, [row])
    expect(await loadPairings(kv)).toEqual([row])
  })

  it('upserts by id or by relay+secret', () => {
    const a = { id: '1', relayUrl: 'wss://r', secret: 's' }
    const list = upsertPairing([], a)
    expect(upsertPairing(list, { ...a, hostName: 'Desk' })[0].hostName).toBe('Desk')
    expect(upsertPairing(list, { id: '2', relayUrl: 'wss://r', secret: 's', lan: 'h:1' })).toHaveLength(1)
  })
})
