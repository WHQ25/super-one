import { describe, expect, it, vi } from 'vitest'
import { RpcConnection } from './rpc-connection'

function connection(coalesces?: (method: string) => boolean) {
  const sent: Array<{ requestId: string; method: string; environmentId: string; protocolVersion: number; idempotencyKey?: string }> = []
  let id = 0
  const conn = new RpcConnection((message) => { sent.push(message as never) }, {
    protocolVersion: 3,
    newId: () => `r${++id}`,
    responseError: (error) => Object.assign(new Error(error.message), { code: error.code }),
    timeoutError: (method) => new Error(`timeout ${method}`),
    coalesces,
  })
  return { conn, sent }
}

describe('RpcConnection', () => {
  it('sends envelopes and settles them by request id', async () => {
    const { conn, sent } = connection()
    const ok = conn.request('session.load', { sessionId: 's' }, { environmentId: 'env' })
    const bad = conn.request('session.send', {}, { environmentId: 'env', idempotencyKey: 'k' })
    expect(sent).toEqual([
      expect.objectContaining({ type: 'rpc', requestId: 'r1', method: 'session.load', environmentId: 'env', protocolVersion: 3 }),
      expect.objectContaining({ requestId: 'r2', idempotencyKey: 'k' }),
    ])
    expect(conn.receive({ type: 'rpc_error', requestId: 'r2', error: { code: 'lease_required', message: 'no lease' } })).toBe(true)
    expect(conn.receive({ type: 'rpc_result', requestId: 'r1', result: { ok: 1 } })).toBe(true)
    await expect(ok).resolves.toEqual({ ok: 1 })
    await expect(bad).rejects.toMatchObject({ code: 'lease_required' })
    expect(conn.receive({ type: 'pong', requestId: 'x' })).toBe(false)
  })

  it('rejects at the deadline and tells the caller', async () => {
    vi.useFakeTimers()
    const { conn } = connection()
    const onTimeout = vi.fn()
    const late = conn.request('git.status', {}, { environmentId: 'env', timeoutMs: 10, onTimeout })
    vi.advanceTimersByTime(10)
    await expect(late).rejects.toThrow('timeout git.status')
    expect(onTimeout).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('routes stream frames and detail packets, and ends them with the connection', async () => {
    const { conn } = connection()
    const stream = { onFrame: vi.fn(), onEnd: vi.fn() }
    const detail = vi.fn()
    conn.openStream('sub', stream)
    conn.watchDetail('row', detail)
    conn.receive({ type: 'stream', subscriptionId: 'sub', frame: { sequence: '1', epoch: 'e', events: [] } })
    conn.receive({ type: 'detail', sessionId: 's', update: { subscriptionId: 'row', revision: 1, offset: 0, text: 'x' } })
    expect(stream.onFrame).toHaveBeenCalledWith({ sequence: '1', epoch: 'e', events: [] })
    expect(detail).toHaveBeenCalledWith({ subscriptionId: 'row', revision: 1, offset: 0, text: 'x' })
    const pending = conn.request('m', {}, { environmentId: 'env' })
    conn.close(new Error('gone'))
    await expect(pending).rejects.toThrow('gone')
    expect(stream.onEnd).toHaveBeenCalledWith(expect.objectContaining({ message: 'gone' }))
    await expect(conn.request('m', {}, { environmentId: 'env' })).rejects.toThrow('gone')
  })

  it('shares identical reads it is told it may, never keyed calls', async () => {
    const { conn, sent } = connection((method) => method === 'session.list')
    const a = conn.request('session.list', { limit: 1, offset: 0 }, { environmentId: 'env' })
    const b = conn.request('session.list', { offset: 0, limit: 1 }, { environmentId: 'env' })
    conn.request('session.get', {}, { environmentId: 'env' })
    conn.request('session.get', {}, { environmentId: 'env' })
    expect(sent.map((m) => m.method)).toEqual(['session.list', 'session.get', 'session.get'])
    conn.receive({ type: 'rpc_result', requestId: 'r1', result: [] })
    await expect(Promise.all([a, b])).resolves.toEqual([[], []])
  })
})
