import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrokAuthService } from './grok-auth-service'
import { authenticateGrokCached } from './grok-cached-auth'
import type { GrokAuthConnection } from './grok-auth-connection'
vi.mock('./grok-auth-connection', () => ({ openGrokAuthConnection: vi.fn() }))

function fixture(cached = false) {
  let finish!: () => void
  const auth = new Promise<void>((resolve) => { finish = resolve })
  const request = vi.fn(async (method: string, _params: Record<string, unknown>): Promise<unknown> => {
    if (method === 'authenticate') return auth
    if (method === 'x.ai/auth/get_url') return { auth_url: 'https://grok.com/login', mode: 'device_code' }
    if (method === 'x.ai/auth/info') return { email: 'test@example.com', token: 'must-not-leak' }
    return {}
  })
  const connection: GrokAuthConnection = {
    initialize: vi.fn(async () => ({ authMethods: cached ? [{ id: 'cached_token' }, { id: 'grok.com' }] : [{ id: 'grok.com' }] })),
    request, close: vi.fn(async () => {}),
  }
  const open = vi.fn(async () => connection)
  return { service: new GrokAuthService(open), connection, open, request, finish }
}
const services: GrokAuthService[] = []
afterEach(async () => { for (const service of services.splice(0)) await service.stop(); vi.useRealTimers() })
async function waiting(f: ReturnType<typeof fixture>) {
  services.push(f.service)
  const started = await f.service.handle({ action: 'start' })
  await vi.waitFor(async () => expect((await f.service.handle({ action: 'status' })).status).toBe('waiting'))
  return started.loginId!
}

describe('Grok settings authentication', () => {
  it('reads CLI credentials without authenticating and exposes only public account data', async () => {
    const f = fixture(true)
    expect(await f.service.handle({ action: 'refresh' })).toEqual({ status: 'signed_in', method: 'cached_token', email: 'test@example.com' })
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(['x.ai/auth/info'])
    expect(f.connection.close).toHaveBeenCalledOnce()
  })
  it('deduplicates starts and completes browser login without a code', async () => {
    const f = fixture(); const loginId = await waiting(f)
    expect((await f.service.handle({ action: 'start' })).loginId).toBe(loginId)
    expect(f.open).toHaveBeenCalledOnce()
    expect(f.request).toHaveBeenCalledWith('authenticate', { methodId: 'grok.com', _meta: { force_interactive: true } })
    f.finish()
    await vi.waitFor(async () => expect((await f.service.handle({ action: 'status' })).status).toBe('signed_in'))
    expect(f.request.mock.calls.map(([method]) => method)).not.toContain('session/new')
    expect(f.connection.close).toHaveBeenCalledOnce()
  })
  it('waits for authentication completion after code delivery', async () => {
    const f = fixture(); const loginId = await waiting(f)
    expect((await f.service.handle({ action: 'submit', loginId, code: '  code-123  ' })).status).toBe('verifying')
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledWith('x.ai/auth/submit_code', { code: 'code-123' }))
    expect((await f.service.handle({ action: 'status' })).status).toBe('verifying')
    f.finish()
    await vi.waitFor(async () => expect((await f.service.handle({ action: 'status' })).status).toBe('signed_in'))
  })
  it('ignores stale requests and cancels the owned process', async () => {
    const f = fixture(); const loginId = await waiting(f)
    expect((await f.service.handle({ action: 'cancel', loginId: 'stale' })).status).toBe('waiting')
    expect((await f.service.handle({ action: 'cancel', loginId })).status).toBe('signed_out')
    expect(f.connection.close).toHaveBeenCalled()
    f.finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect((await f.service.handle({ action: 'status' })).status).toBe('signed_out')
  })
  it('reports a missing CLI', async () => {
    const service = new GrokAuthService(async () => null)
    expect(await service.handle({ action: 'refresh' })).toEqual({ status: 'unavailable' })
  })
  it('times out and cleans up an abandoned browser login', async () => {
    vi.useFakeTimers()
    const f = fixture(); services.push(f.service)
    await f.service.handle({ action: 'start' })
    await vi.advanceTimersByTimeAsync(180_000)
    expect((await f.service.handle({ action: 'status' })).status).toBe('error')
    expect(f.connection.close).toHaveBeenCalled()
  })
  it('refuses the expired-token browser fallback during chat', async () => {
    const f = fixture()
    await expect(authenticateGrokCached(f.request, 'cached_token')).rejects.toThrow(/Settings → Harnesses/)
    expect(f.request).toHaveBeenCalledWith('x.ai/auth/cancel', {})
  })
  it('allows slow silent token refresh without requesting browser login', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const auth = new Promise<void>((resolve) => { finish = resolve })
    const request = vi.fn(async (method: string) => method === 'authenticate' ? auth : { auth_url: null })
    const result = authenticateGrokCached(request, 'cached_token')
    await vi.advanceTimersByTimeAsync(5_000)
    finish()
    await result
    expect(request.mock.calls.map(([method]) => method)).not.toContain('x.ai/auth/cancel')
  })
  it('does not poll browser login when using an API key', async () => {
    const request = vi.fn(async () => ({}))
    await authenticateGrokCached(request, 'xai.api_key')
    expect(request).toHaveBeenCalledExactlyOnceWith('authenticate', { methodId: 'xai.api_key' })
  })
  it('bounds hung chat authentication', async () => {
    vi.useFakeTimers()
    const result = authenticateGrokCached(() => new Promise(() => {}), 'cached_token')
    const assertion = expect(result).rejects.toThrow(/Settings → Harnesses/)
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })
})
