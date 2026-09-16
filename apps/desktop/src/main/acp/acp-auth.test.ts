import { describe, expect, it } from 'vitest'
import {
  isInteractiveAcpAuthMethod,
  isNonInteractiveAcpAuthMethod,
  parseGrokAuthUrl,
  pickNonInteractiveAcpAuthMethod,
} from './acp-auth'

describe('pickNonInteractiveAcpAuthMethod', () => {
  it('prefers cached_token when advertised', () => {
    expect(pickNonInteractiveAcpAuthMethod(
      [{ id: 'cached_token' }, { id: 'grok.com' }],
      'cached_token',
    )).toBe('cached_token')
  })

  it('picks xai.api_key when that is the only silent method', () => {
    expect(pickNonInteractiveAcpAuthMethod(
      [{ id: 'grok.com' }, { id: 'xai.api_key' }],
      'grok.com',
    )).toBe('xai.api_key')
  })

  it('returns null when only grok.com / oidc are advertised', () => {
    expect(pickNonInteractiveAcpAuthMethod(
      [{ id: 'grok.com' }, { id: 'enterprise-oidc' }],
      'grok.com',
    )).toBeNull()
  })
})

describe('auth method classification', () => {
  it('treats cached_token and api_key as non-interactive', () => {
    expect(isNonInteractiveAcpAuthMethod('cached_token')).toBe(true)
    expect(isNonInteractiveAcpAuthMethod('xai.api_key')).toBe(true)
    expect(isNonInteractiveAcpAuthMethod('grok.com')).toBe(false)
    expect(isInteractiveAcpAuthMethod('grok.com')).toBe(true)
    expect(isInteractiveAcpAuthMethod('oidc')).toBe(true)
  })
})

describe('parseGrokAuthUrl', () => {
  it('reads snake_case get_url payload', () => {
    expect(parseGrokAuthUrl({
      auth_url: 'https://grok.com/device',
      external_provider: true,
      mode: 'device_code',
    })).toEqual({
      authUrl: 'https://grok.com/device',
      mode: 'device_code',
      externalProvider: true,
    })
  })

  it('returns null without a URL', () => {
    expect(parseGrokAuthUrl({ mode: 'device_code' })).toBeNull()
  })
})
