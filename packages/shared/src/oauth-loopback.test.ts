import { describe, expect, it } from 'vitest'
import { loopbackOAuthRedirect, validateLoopbackOAuthCallback } from './oauth-loopback'

const authorize = 'https://login.example/auth?state=original&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback'
const callback = 'http://127.0.0.1:12345/callback?code=test&state=original'

describe('loopback OAuth callback', () => {
  it('finds only a loopback http redirect', () => {
    expect(loopbackOAuthRedirect(authorize)?.href).toBe('http://127.0.0.1:12345/callback')
    expect(loopbackOAuthRedirect('https://login.example/auth')).toBeNull()
    expect(loopbackOAuthRedirect('https://login.example/auth?redirect_uri=https%3A%2F%2Fapp.example%2Fcb')).toBeNull()
    expect(loopbackOAuthRedirect('not a url')).toBeNull()
  })

  it('accepts the original loopback callback and rejects other origins, paths and attempts', () => {
    expect(validateLoopbackOAuthCallback(authorize, callback).href).toBe(callback)
    for (const candidate of [
      callback.replace('12345', '12346'),
      callback.replace('/callback', '/admin'),
      callback.replace('state=original', 'state=other'),
      callback.replace('code=test&', ''),
      callback.replace('http:', 'file:'),
      `${callback}#fragment`,
      callback.replace('127.0.0.1', 'user:secret@127.0.0.1'),
      'not a url',
    ])
      expect(() => validateLoopbackOAuthCallback(authorize, candidate)).toThrow()
  })
})
