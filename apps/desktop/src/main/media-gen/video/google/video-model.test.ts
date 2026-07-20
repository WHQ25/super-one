import { describe, expect, it } from 'vitest'
import { createGoogleVideoDriver } from './video-model'
import type { VideoModelV4CallOptions } from '../sdk-types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const OPERATION = 'models/veo-3/operations/abc123'

function driverWith(handler: (url: string) => Response) {
  const urls: string[] = []
  const fetchMock = (async (url: string) => {
    urls.push(url)
    return handler(url)
  }) as unknown as typeof globalThis.fetch
  const driver = createGoogleVideoDriver(
    { provider: 'google', baseURL: BASE, apiKey: 'secret-key', fetch: fetchMock },
    'veo-3',
  )
  return { driver, urls }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function done(uri: string): Response {
  return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } } })
}

describe('veo video driver', () => {
  it('persists the operation name as the task handle so a later call can ask about the job', async () => {
    const { driver, urls } = driverWith(() => json({ name: OPERATION }))

    const { taskId } = await driver.submit({ prompt: 'a cat', n: 1 } as VideoModelV4CallOptions)

    expect(urls).toEqual([`${BASE}/models/veo-3:predictLongRunning`])
    expect(taskId).toBe(OPERATION)
  })

  it('reports a not-yet-done operation as running rather than as a failure', async () => {
    const { driver, urls } = driverWith(() => json({ name: OPERATION, done: false }))

    const task = await driver.fetch(OPERATION)

    expect(urls).toEqual([`${BASE}/${OPERATION}`])
    expect(task.status).toBe('running')
  })

  it('treats a done operation carrying an error as failed', async () => {
    const { driver } = driverWith(() => json({ done: true, error: { message: 'safety filter' } }))

    const task = await driver.fetch(OPERATION)

    expect(task.status).toBe('failed')
    expect(task.error).toMatch(/safety filter/)
  })

  it('appends the api key when the result uri is on the api host, which is not pre-signed', async () => {
    const { driver, urls } = driverWith((url) =>
      url.includes(':predictLongRunning') || url.includes('/operations/')
        ? done(`${BASE}/files/xyz:download`)
        : new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    )

    const task = await driver.fetch(OPERATION)
    await driver.download(task)

    expect(urls[1]).toBe(`${BASE}/files/xyz:download?key=secret-key`)
  })

  it('never appends the api key to a third-party result host', async () => {
    const { driver, urls } = driverWith((url) =>
      url.startsWith('https://cdn.example')
        ? new Response(new Uint8Array([1]), { status: 200 })
        : done('https://cdn.example/video.mp4?sig=abc'),
    )

    const task = await driver.fetch(OPERATION)
    await driver.download(task)

    expect(urls[1]).toBe('https://cdn.example/video.mp4?sig=abc')
    expect(urls[1]).not.toContain('secret-key')
  })
})
