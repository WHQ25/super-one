import { describe, it, expect } from 'vitest'
import {
  buildAgentErrorClipboardText,
  buildAgentErrorDetails,
  resolveAgentErrorKind,
} from './agent-error-presentation'

describe('resolveAgentErrorKind', () => {
  it.each([
    ['sandbox_required_unavailable', 'sandboxUnavailable'],
    ['initialize_not_first', 'initializationError'],
    ['config_file_invalid', 'configInvalid'],
  ])('uses the startup reason %s ahead of generic error codes', (reason, kind) => {
    const info = { raw: 'original recovery steps', code: 'invalid_request', startupFailureReason: reason }
    expect(resolveAgentErrorKind(info)).toBe(kind)
    expect(buildAgentErrorClipboardText(info)).toContain(`startup_failure_reason  ${reason}`)
  })

  it('prefers terminal_reason when it is more specific than the typed code', () => {
    // The SDK reports prompt-length failures as the vague code `invalid_request`;
    // only terminal_reason says what actually went wrong.
    expect(resolveAgentErrorKind({
      raw: 'input length exceeds the maximum',
      code: 'invalid_request',
      terminalReason: 'prompt_too_long',
    })).toBe('promptTooLong')
  })

  it('falls back to the typed code when terminal_reason is the generic api_error bucket', () => {
    expect(resolveAgentErrorKind({
      raw: 'Overloaded',
      code: 'overloaded',
      terminalReason: 'api_error',
    })).toBe('overloaded')
  })

  it('uses the result subtype when neither reason nor code maps', () => {
    expect(resolveAgentErrorKind({ raw: '', subtype: 'error_max_turns' })).toBe('maxTurns')
  })

  it('derives a kind from the HTTP status for harnesses that report no typed code', () => {
    expect(resolveAgentErrorKind({ raw: 'Unauthorized', httpStatus: 401 })).toBe('auth')
    expect(resolveAgentErrorKind({ raw: 'Too many requests', httpStatus: 429 })).toBe('rateLimit')
    expect(resolveAgentErrorKind({ raw: 'Bad gateway', httpStatus: 502 })).toBe('serverError')
  })

  it('keeps a 403 verification_required distinct from a rejected sign-in', () => {
    expect(resolveAgentErrorKind({
      raw: "Your account can't receive replies from Claude right now",
      code: 'verification_required',
      httpStatus: 403,
      terminalReason: 'api_error',
    })).toBe('verificationRequired')
    expect(resolveAgentErrorKind({
      raw: 'OAuth token has expired or been revoked',
      code: 'authentication_failed',
      httpStatus: 401,
    })).toBe('auth')
  })

  it('lands on unknown when nothing maps, so the raw text becomes the display', () => {
    expect(resolveAgentErrorKind({ raw: 'spawn ENOENT' })).toBe('unknown')
    expect(resolveAgentErrorKind({ raw: 'weird', code: 'brand_new_code', terminalReason: 'brand_new_reason' })).toBe('unknown')
  })
})

describe('buildAgentErrorDetails', () => {
  it('omits every field the harness did not supply', () => {
    expect(buildAgentErrorDetails({ raw: 'boom' })).toEqual([])
  })

  it('renders the retry ladder in seconds with its ceiling', () => {
    const rows = buildAgentErrorDetails({ raw: 'Overloaded', retries: { attempts: 3, delaysMs: [2000, 4000, 8000], max: 3 } })
    expect(rows).toContainEqual({ label: 'retries', value: '2.0s → 4.0s → 8.0s (max 3)' })
  })

  it('reports a bare attempt count for harnesses that report no backoff delays', () => {
    // Codex retries in-process and never puts a delay on the wire.
    const rows = buildAgentErrorDetails({ raw: 'stream error', retries: { attempts: 2 } })
    expect(rows).toContainEqual({ label: 'retries', value: '2 attempts' })
    expect(buildAgentErrorDetails({ raw: 'x', retries: { attempts: 1 } }))
      .toContainEqual({ label: 'retries', value: '1 attempt' })
  })
})

describe('buildAgentErrorClipboardText', () => {
  it('pads labels into a column and ends with the raw upstream text', () => {
    const text = buildAgentErrorClipboardText({
      raw: 'OAuth token has expired',
      code: 'authentication_failed',
      httpStatus: 401,
    })
    expect(text).toBe('code  authentication_failed\nhttp  401\n\nOAuth token has expired')
  })

  it('is just the raw text when there is nothing structured to report', () => {
    expect(buildAgentErrorClipboardText({ raw: 'spawn ENOENT' })).toBe('spawn ENOENT')
  })
})
