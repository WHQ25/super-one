import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairWithNode } from './node-auth-client'

describe('node authentication transport errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('identifies pairing failures through a local SSH forward', async () => {
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
        'pairing request failed for local SSH forward endpoint http://127.0.0.1:43123/v1/pair: fetch failed',
    })
  })
})
