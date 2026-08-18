import { describe, it, expect } from 'vitest'
import {
  ACP_RATE_LIMITED_ERROR_CODE,
  describeAcpRequestError,
  describeAcpRequestFailure,
} from './acp-request-error'

/** Shape Grok returns for a quota-exhausted `session/prompt`. */
function rpcError(code: number, message: string, data?: unknown) {
  return { code, message, data }
}

describe('describeAcpRequestFailure', () => {
  it('recovers the HTTP status the display string deliberately strips', () => {
    const err = rpcError(-32000, 'Sampling failed', 'API error (status 429): slow down please')
    // The user-facing text stays clean…
    expect(describeAcpRequestError(err)).toBe('slow down please')
    // …while the badge still gets the status behind it.
    expect(describeAcpRequestFailure(err)).toMatchObject({ raw: 'slow down please', httpStatus: 429 })
  })

  it('trusts the JSON-RPC rate-limit code over anything read from the prose', () => {
    const err = rpcError(ACP_RATE_LIMITED_ERROR_CODE, 'Rate limited', 'subscription:free-usage-exhausted')
    const info = describeAcpRequestFailure(err)
    expect(info.code).toBe('rate_limit')
    expect(info.raw).toContain('free Grok Build usage limit')
  })

  it('classifies a plain Error by its text when there is no JSON-RPC envelope', () => {
    expect(describeAcpRequestFailure(new Error('Invalid API key provided'))).toMatchObject({
      code: 'authentication_failed',
      raw: 'Invalid API key provided',
    })
  })

  it('leaves an unrecognizable failure unlabelled rather than guessing', () => {
    const info = describeAcpRequestFailure(new Error('spawn grok ENOENT'))
    expect(info.raw).toBe('spawn grok ENOENT')
    expect(info.code).toBeUndefined()
  })
})
