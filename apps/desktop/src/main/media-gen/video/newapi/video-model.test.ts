import { describe, expect, it } from 'vitest'
import { createNewApiVideoDriver } from './video-model'
import type { VideoModelV4CallOptions } from '../sdk-types'

const BASE = 'https://relay.example/v1'

function callOptions(): VideoModelV4CallOptions {
  return { prompt: 'a cat', n: 1 } as VideoModelV4CallOptions
}

function driverWith(handler: (url: string) => Response) {
  const urls: string[] = []
  const fetchMock = (async (url: string) => {
    urls.push(url)
    return handler(url)
  }) as unknown as typeof globalThis.fetch
  const driver = createNewApiVideoDriver(
    { provider: 'newapi', baseURL: BASE, apiKey: 'k', fetch: fetchMock },
    'doubao-seedance-2-0',
  )
  return { driver, urls }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('newapi video driver', () => {
  it('reads status from the OpenAI-compatible /videos route, not the TaskDto-enveloped one', async () => {
    const { driver, urls } = driverWith(() => json({ id: 'task-1', status: 'in_progress' }))

    const task = await driver.fetch('task-1')

    expect(urls).toEqual([`${BASE}/videos/task-1`])
    expect(task.status).toBe('running')
  })

  it('reports the transient "unknown" of a NOT_START task as running so the caller asks again', async () => {
    const { driver } = driverWith(() => json({ id: 'task-1', status: 'unknown' }))

    const task = await driver.fetch('task-1')

    expect(task.status).toBe('running')
    expect(task.rawStatus).toBe('unknown')
  })

  it('returns the submitted job id as the task handle', async () => {
    const { driver, urls } = driverWith(() => json({ id: 'task-1', status: 'queued' }))

    const { taskId } = await driver.submit(callOptions())

    expect(urls).toEqual([`${BASE}/video/generations`])
    expect(taskId).toBe('task-1')
  })

  it('fetches bytes from the relay content proxy rather than the vendor url in metadata', async () => {
    const { driver, urls } = driverWith(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))

    const { data, mediaType } = await driver.download({ id: 'task-1', status: 'succeeded' })

    expect(urls).toEqual([`${BASE}/videos/task-1/content`])
    expect(data).toHaveLength(3)
    expect(mediaType).toBe('video/mp4')
  })

  it('issues exactly one request per fetch so the caller controls the cadence', async () => {
    const { driver, urls } = driverWith(() => json({ id: 'task-1', status: 'queued' }))

    await driver.fetch('task-1')
    await driver.fetch('task-1')

    expect(urls).toHaveLength(2)
  })
})
