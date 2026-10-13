import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRemoteOpenCodeSignIn, validateOpenCodeOAuthCallback } from './remote-oauth'

const authorize = 'https://login.example/auth?state=original&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback'
const callback = 'http://127.0.0.1:12345/callback?code=test&state=original'
afterEach(() => vi.unstubAllGlobals())
describe('remote OpenCode OAuth callback', () => {
  it('accepts the original native loopback callback and rejects other origins, paths and attempts', () => {
    expect(validateOpenCodeOAuthCallback(authorize, callback).href).toBe(callback)
    for (const candidate of [
      callback.replace('12345', '12346'),
      callback.replace('/callback', '/admin'),
      callback.replace('state=original', 'state=other'),
      callback.replace('http:', 'file:'),
      `${callback}#fragment`,
      callback.replace('127.0.0.1', 'user:secret@127.0.0.1'),
    ])
      expect(() => validateOpenCodeOAuthCallback(authorize, candidate)).toThrow()
  })
  it('checks captured control after the answer and before forwarding the callback', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const assertControl = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new Error('stale lease')
      })
    await expect(
      openRemoteOpenCodeSignIn(
        authorize,
        { mode: 'auto', signal: new AbortController().signal },
        {
          assertControl,
          onQuestion: async () => ({ 'Sign-in callback URL': callback }),
          onEvent: () => {},
          onPermission: async () => 'deny',
        },
      ),
    ).rejects.toThrow('stale lease')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('forwards only the validated callback and never follows redirects', async () => {
    const fetch = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetch)
    await openRemoteOpenCodeSignIn(
      authorize,
      { mode: 'auto', signal: new AbortController().signal },
      {
        assertControl: () => {},
        onQuestion: async () => ({ 'Sign-in callback URL': callback }),
        onEvent: () => {},
        onPermission: async () => 'deny',
      },
    )
    expect(fetch).toHaveBeenCalledWith(
      new URL(callback),
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    )
  })
  it('cancels without forwarding when the controller dismisses the question', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      openRemoteOpenCodeSignIn(
        authorize,
        { mode: 'auto', signal: new AbortController().signal },
        {
          assertControl: () => {},
          onQuestion: async () => ({}),
          onEvent: () => {},
          onPermission: async () => 'deny',
        },
      ),
    ).rejects.toThrow('cancelled')
    expect(fetch).not.toHaveBeenCalled()
  })
})
