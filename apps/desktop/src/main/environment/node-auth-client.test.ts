import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairWithNode } from './node-auth-client'

describe('node authentication transport errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('identifies pairing failures through a loopback node endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(
      pairWithNode({
        baseUrl: 'http://127.0.0.1:43123',
        pairingToken: 'one-time-token',
        devicePublicKeyPem: 'public-key',
      }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      message:
        'pairing request failed for loopback node endpoint http://127.0.0.1:43123/v1/pair: fetch failed',
    })
  })

  it('surfaces timeout as timed out after NODE_REQUEST_TIMEOUT_MS', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))

    await expect(
      pairWithNode({
        baseUrl: 'http://127.0.0.1:43123',
        pairingToken: 'one-time-token',
        devicePublicKeyPem: 'public-key',
      }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('timed out after 15000ms'),
    })
  })
})
