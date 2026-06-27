import { describe, it, expect } from 'vitest'
import worker from './index'
import { computeHmacToken, computeRoomId } from './auth'

const R2_ENV = {
  R2_ACCOUNT_ID: 'acct',
  R2_BUCKET_NAME: 'bucket',
  R2_ACCESS_KEY_ID: 'akid',
  R2_SECRET_ACCESS_KEY: 'secret',
} as const

const CHANNEL_KEY = 'a'.repeat(64)

function makeEnv(overrides: Record<string, unknown> = {}) {
  return { ...R2_ENV, RELAY_SESSION: {}, PAIRING_SESSION: {}, ...overrides } as never
}

async function deleteUrlRequest(body: Record<string, unknown>) {
  return new Request('https://relay.test/files/delete-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('relay /files/delete-url', () => {
  it('returns a presigned DELETE url for a valid desktop request', async () => {
    const ts = Date.now().toString()
    const sig = await computeHmacToken(CHANNEL_KEY, 'desktop', ts)
    const roomId = await computeRoomId(CHANNEL_KEY)
    const key = `files/${roomId}/abcdef.bin`

    const res = await worker.fetch(await deleteUrlRequest({ channelKey: CHANNEL_KEY, role: 'desktop', ts, sig, key }), makeEnv())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { deleteUrl?: string }
    expect(json.deleteUrl).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/bucket\/files\//)
    expect(json.deleteUrl).toMatch(/X-Amz-Signature=/)
  })

  it('rejects the mobile role', async () => {
    const ts = Date.now().toString()
    const sig = await computeHmacToken(CHANNEL_KEY, 'mobile', ts)
    const roomId = await computeRoomId(CHANNEL_KEY)
    const key = `files/${roomId}/abcdef.bin`

    const res = await worker.fetch(await deleteUrlRequest({ channelKey: CHANNEL_KEY, role: 'mobile', ts, sig, key }), makeEnv())
    expect(res.status).toBe(400)
  })

  it('rejects a key outside the channel room prefix', async () => {
    const ts = Date.now().toString()
    const sig = await computeHmacToken(CHANNEL_KEY, 'desktop', ts)
    const res = await worker.fetch(
      await deleteUrlRequest({ channelKey: CHANNEL_KEY, role: 'desktop', ts, sig, key: 'files/other-room/abcdef.bin' }),
      makeEnv(),
    )
    expect(res.status).toBe(403)
  })

  it('returns 503 when R2 is not configured', async () => {
    const ts = Date.now().toString()
    const sig = await computeHmacToken(CHANNEL_KEY, 'desktop', ts)
    const roomId = await computeRoomId(CHANNEL_KEY)
    const key = `files/${roomId}/abcdef.bin`
    const env = makeEnv({ R2_ACCOUNT_ID: '', R2_BUCKET_NAME: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' })
    const res = await worker.fetch(await deleteUrlRequest({ channelKey: CHANNEL_KEY, role: 'desktop', ts, sig, key }), env)
    expect(res.status).toBe(503)
  })
})
