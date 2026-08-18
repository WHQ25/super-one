import { describe, it, expect } from 'vitest'
import { buildAgentErrorInfo, classifyAgentErrorText } from './agent-error'

describe('classifyAgentErrorText', () => {
  it('reads a status only when a keyword anchors it', () => {
    expect(classifyAgentErrorText('API error (status 429): slow down')).toMatchObject({ httpStatus: 429 })
    expect(classifyAgentErrorText('HTTP 401 unauthorized')).toMatchObject({ httpStatus: 401 })
    // Bare three-digit runs are version strings and byte counts far more often than statuses.
    expect(classifyAgentErrorText('opencode 402 tokens written to /tmp/out').httpStatus).toBeUndefined()
  })

  it('ignores success-range numbers that happen to sit next to a keyword', () => {
    expect(classifyAgentErrorText('status 200 but the stream closed').httpStatus).toBeUndefined()
  })

  it('recognizes the phrases every provider words differently', () => {
    expect(classifyAgentErrorText('You have hit the rate limit for your plan').code).toBe('rate_limit')
    expect(classifyAgentErrorText('Overloaded, please retry').code).toBe('overloaded')
    expect(classifyAgentErrorText('Invalid API key provided').code).toBe('authentication_failed')
    expect(classifyAgentErrorText('Insufficient credit on this account').code).toBe('billing_error')
    expect(classifyAgentErrorText('model grok-4 is not available').code).toBe('model_not_found')
    expect(classifyAgentErrorText('Internal server error').code).toBe('server_error')
  })

  it('marks context overflow with the terminal reason the badge keys off', () => {
    expect(classifyAgentErrorText('prompt is too long: 231402 tokens > 200000')).toMatchObject({
      code: 'invalid_request',
      terminalReason: 'prompt_too_long',
    })
  })

  it('falls back to the status when no phrase matches', () => {
    expect(classifyAgentErrorText('request failed with status 503')).toEqual({
      httpStatus: 503,
      code: 'server_error',
    })
  })

  it('returns nothing rather than guess', () => {
    expect(classifyAgentErrorText('spawn /usr/local/bin/opencode ENOENT')).toEqual({})
    expect(classifyAgentErrorText('   ')).toEqual({})
  })
})

describe('buildAgentErrorInfo', () => {
  it('lets a provider-known field beat the regex', () => {
    const info = buildAgentErrorInfo('API error (status 429): slow down', { code: 'billing_error', httpStatus: 402 })
    expect(info).toMatchObject({ code: 'billing_error', httpStatus: 402 })
  })

  it('keeps the raw text intact and never leaves it empty', () => {
    expect(buildAgentErrorInfo('  Overloaded  ').raw).toBe('Overloaded')
    expect(buildAgentErrorInfo('').raw).toBe('Unknown error')
  })

  it('omits keys an override cleared so absent-field checks still hold', () => {
    const info = buildAgentErrorInfo('Internal server error', { code: undefined })
    expect('code' in info).toBe(false)
  })
})
