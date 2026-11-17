import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import { IdempotencyService } from './idempotency'
import { dispatchRpc } from '../rpc/handlers'

let db: NodeDatabase
let service: IdempotencyService
beforeEach(() => {
  db = openNodeDatabase(':memory:')
  service = new IdempotencyService(db)
})
afterEach(() => db.close())

describe('conflicting send receipts', () => {
  it('reports durable success evidence through the RPC error', async () => {
    service.store('client', 'session.send', 'send-1', service.payloadHash({ text: 'original' }), { accepted: true })
    const result = await dispatchRpc('session.send', { text: 'changed' }, {
      client: { clientSessionId: 'client' }, idempotencyKey: 'send-1', idempotency: service,
    } as never)
    expect(result).toMatchObject({ error: { code: 'idempotency_conflict', details: { receiptStored: true } } })
  })

  it('does not claim success for a pending request that later fails', async () => {
    let reject!: (error: Error) => void
    const pending = service.runExclusive('client', 'session.send', 'send-1', 'original', () => new Promise((_, fail) => { reject = fail }))
    const failure = expect(pending).rejects.toThrow('send failed')
    const conflict = await service.runExclusive('client', 'session.send', 'send-1', 'changed', async () => ({})).catch(error => error)
    expect(conflict).toMatchObject({ code: 'idempotency_conflict' })
    expect(conflict.details).toBeUndefined()
    reject(new Error('send failed'))
    await failure
    await expect(service.runExclusive('client', 'session.send', 'send-1', 'changed', async () => ({ accepted: true })))
      .resolves.toEqual({ accepted: true })
  })
})

describe('dead receipts', () => {
  it('re-executes when a dead receipt was stored for a different payload', async () => {
    const operation = 'session.create'
    service.store('client', operation, 'k', service.payloadHash({ cwd: '/old' }), { sessionId: 's1' })
    let ran = false
    const result = await service.runExclusive(
      'client', operation, 'k', service.payloadHash({ cwd: '/new' }),
      async () => { ran = true; return { sessionId: 's2' } },
      { isReceiptLive: () => false },
    )
    expect(ran).toBe(true)
    expect(result).toEqual({ sessionId: 's2' })
    expect(service.lookup('client', operation, 'k', service.payloadHash({ cwd: '/new' }))).toEqual({ sessionId: 's2' })
  })

  it('still conflicts when a live receipt has a different payload', async () => {
    service.store('client', 'session.create', 'k', service.payloadHash({ cwd: '/old' }), { sessionId: 's1' })
    await expect(service.runExclusive(
      'client', 'session.create', 'k', service.payloadHash({ cwd: '/new' }),
      async () => ({ sessionId: 's2' }),
      { isReceiptLive: () => true },
    )).rejects.toMatchObject({ code: 'idempotency_conflict', details: { receiptStored: true } })
    expect(service.lookup('client', 'session.create', 'k', service.payloadHash({ cwd: '/old' }))).toEqual({ sessionId: 's1' })
  })
})
