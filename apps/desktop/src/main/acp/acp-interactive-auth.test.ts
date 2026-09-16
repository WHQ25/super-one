import { describe, expect, it, vi } from 'vitest'
import { authenticateGrokInteractively } from './acp-interactive-auth'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function login() {
  const auth = deferred<unknown>()
  const ops = {
    authenticate: vi.fn(() => auth.promise),
    getUrl: vi.fn(async () => ({ auth_url: 'https://grok.com/login', mode: 'device_code' })),
    submitCode: vi.fn(async (_code: string) => ({})),
    cancel: vi.fn(async () => ({})),
    request: vi.fn(async () => ({ kind: 'code' as const, code: '1234' })),
  }
  return { auth, ops }
}

describe('interactive Grok authentication lifecycle', () => {
  it('starts authentication before polling and waits beyond submit_code acknowledgement', async () => {
    const { auth, ops } = login()
    let finished = false
    const result = authenticateGrokInteractively(ops).then(() => { finished = true })
    await vi.waitFor(() => expect(ops.submitCode).toHaveBeenCalledWith('1234'))
    expect(ops.authenticate.mock.invocationCallOrder[0]).toBeLessThan(ops.getUrl.mock.invocationCallOrder[0]!)
    expect(finished).toBe(false)
    auth.resolve({})
    await result
    expect(ops.authenticate).toHaveBeenCalledTimes(1)
  })

  it('surfaces authentication failure after a code was delivered', async () => {
    const { auth, ops } = login()
    const result = authenticateGrokInteractively(ops)
    const assertion = expect(result).rejects.toThrow('invalid code')
    await vi.waitFor(() => expect(ops.submitCode).toHaveBeenCalled())
    auth.reject(new Error('invalid code'))
    await assertion
    expect(ops.cancel).toHaveBeenCalledOnce()
  })

  it('does not restart authentication for a browser-completed flow', async () => {
    const { auth, ops } = login()
    const result = authenticateGrokInteractively({ ...ops, request: async () => ({ kind: 'opened' }) })
    await vi.waitFor(() => expect(ops.getUrl).toHaveBeenCalled())
    auth.resolve({})
    await result
    expect(ops.authenticate).toHaveBeenCalledTimes(1)
    expect(ops.submitCode).not.toHaveBeenCalled()
  })

  it('cancels an outstanding attempt when the user dismisses login', async () => {
    const { ops } = login()
    await expect(authenticateGrokInteractively({ ...ops, request: async () => ({ kind: 'cancel' }) }))
      .rejects.toThrow('Grok login cancelled')
    expect(ops.cancel).toHaveBeenCalledOnce()
  })

  it('finishes when cached credentials succeed without an auth URL', async () => {
    const { auth, ops } = login()
    auth.resolve({})
    await authenticateGrokInteractively({ ...ops, getUrl: () => new Promise(() => {}) })
    expect(ops.request).not.toHaveBeenCalled()
  })

  it('does not hang on get_url after authenticate fails', async () => {
    const { auth, ops } = login()
    auth.reject(new Error('auth unavailable'))
    await expect(authenticateGrokInteractively({ ...ops, getUrl: () => new Promise(() => {}) }))
      .rejects.toThrow('auth unavailable')
  })
})
