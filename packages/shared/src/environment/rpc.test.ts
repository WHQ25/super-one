import { describe, expect, it } from 'vitest'
import { isRpcErrorResponse, type RpcCommandEnvelope } from './rpc'

describe('RpcCommandEnvelope shape', () => {
  it('carries protocol version, request id, environment, and method', () => {
    const env: RpcCommandEnvelope<{ text: string }> = {
      protocolVersion: 1,
      requestId: 'req-1',
      idempotencyKey: 'idem-1',
      environmentId: 'env-1',
      method: 'sessions.send',
      payload: { text: 'hi' },
    }
    expect(env.method).toBe('sessions.send')
    expect(env.idempotencyKey).toBe('idem-1')
  })
})

describe('isRpcErrorResponse', () => {
  it('recognizes error envelopes', () => {
    expect(
      isRpcErrorResponse({
        requestId: 'r1',
        error: { code: 'forbidden', message: 'nope' },
      }),
    ).toBe(true)
    expect(isRpcErrorResponse({ requestId: 'r1', result: {} })).toBe(false)
    expect(isRpcErrorResponse(null)).toBe(false)
  })
})
