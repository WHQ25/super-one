import { describe, expect, it, vi } from 'vitest'
import { NetworkError } from '@cursor/sdk'
import {
  CURSOR_NETWORK_RETRY_BASE_DELAY_MS,
  isCursorRetryableNetworkError,
  withCursorNetworkRetries,
} from './cursor-network-retry'

describe('isCursorRetryableNetworkError', () => {
  it('accepts SDK NetworkError when retryable', () => {
    expect(isCursorRetryableNetworkError(new NetworkError('Network request failed', { isRetryable: true }))).toBe(true)
    expect(isCursorRetryableNetworkError(new NetworkError('down', { isRetryable: false }))).toBe(false)
  })

  it('accepts duck-typed NetworkError from serialized logs', () => {
    expect(isCursorRetryableNetworkError({
      name: 'NetworkError',
      message: 'Network request failed',
      isRetryable: true,
    })).toBe(true)
  })

  it('rejects other errors', () => {
    expect(isCursorRetryableNetworkError(new Error('Network request failed'))).toBe(false)
    expect(isCursorRetryableNetworkError('Network request failed')).toBe(false)
  })
})

describe('withCursorNetworkRetries', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withCursorNetworkRetries(fn, { sleep: async () => undefined })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries retryable network errors five times then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new NetworkError('Network request failed', { isRetryable: true }))
      .mockRejectedValueOnce(new NetworkError('Network request failed', { isRetryable: true }))
      .mockRejectedValueOnce(new NetworkError('Network request failed', { isRetryable: true }))
      .mockRejectedValueOnce(new NetworkError('Network request failed', { isRetryable: true }))
      .mockRejectedValueOnce(new NetworkError('Network request failed', { isRetryable: true }))
      .mockResolvedValueOnce('ok')
    const onRetry = vi.fn()
    await expect(withCursorNetworkRetries(fn, { sleep: async () => undefined, onRetry })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(6)
    expect(onRetry).toHaveBeenCalledTimes(5)
    expect(onRetry.mock.calls.map((call) => call[0].delayMs)).toEqual([2000, 4000, 8000, 8000, 8000])
  })

  it('defaults to a 2s base delay capped at 8s', () => {
    expect(CURSOR_NETWORK_RETRY_BASE_DELAY_MS).toBe(2000)
  })

  it('stops after five retries and throws the last network error', async () => {
    const last = new NetworkError('still down', { isRetryable: true, endpoint: 'GET /v1/models' })
    const fn = vi.fn().mockRejectedValue(last)
    await expect(withCursorNetworkRetries(fn, { sleep: async () => undefined })).rejects.toBe(last)
    expect(fn).toHaveBeenCalledTimes(6)
  })

  it('does not retry non-network errors', async () => {
    const err = new Error('sandbox missing')
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withCursorNetworkRetries(fn, { sleep: async () => undefined })).rejects.toBe(err)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
