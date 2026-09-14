import { expect, it } from 'vitest'
import { TransportLedger } from './transport-ledger'

it('counts logical requests separately from frames, decoded bytes and event traffic', () => {
  const ledger = new TransportLedger()
  ledger.mark('connect')
  ledger.record({ kind: 'rpc', name: 'get_git_info', count: 1, durationMs: 3 })
  ledger.record({ kind: 'rpc', name: 'get_git_info', count: 1, durationMs: 3 })
  ledger.record({ kind: 'wire-in', name: 'response', bytes: 150 })
  ledger.record({ kind: 'decoded', name: 'response', bytes: 1000, durationMs: 1 })
  ledger.record({ kind: 'wire-in', name: 'event', bytes: 60 })
  const snapshot = ledger.snapshot()
  expect(snapshot.rows.find(r => r.name === 'get_git_info')?.count).toBe(2)
  expect(snapshot.rows.filter(r => r.kind === 'wire-in').reduce((n, r) => n + r.bytes, 0)).toBe(210)
  expect(snapshot.moment).toBe('connect')
  ledger.reset()
  expect(ledger.snapshot().rows).toEqual([])
})
