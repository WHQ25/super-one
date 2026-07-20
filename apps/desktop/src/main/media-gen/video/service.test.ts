import { mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { fetchVideoTask, persistVideoTask, submitVideoTask } from './service'
import type { MediaProviderConfig } from '../types'

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])

function outDir(): string {
  return mkdtempSync(join(tmpdir(), 'video-service-'))
}

function json(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), { status: ok ? status : 400 })
}

/**
 * Routes a fake fetch by URL so a test reads as the API conversation it is asserting, rather than
 * a positional list of mock return values.
 */
function router(routes: Array<[RegExp, () => Response]>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    for (const [pattern, respond] of routes) {
      if (pattern.test(`${method} ${url}`)) return respond()
    }
    throw new Error(`unrouted request: ${method} ${url}`)
  }) as typeof globalThis.fetch
}

const ARK: MediaProviderConfig = {
  id: 'ark-cred',
  kind: 'ark',
  apiKey: 'k',
  baseURL: 'https://ark.example/api/v3',
}

const SORA: MediaProviderConfig = {
  id: 'openai-cred',
  kind: 'openai',
  apiKey: 'k',
  baseURL: 'https://api.openai.example/v1',
}

describe('video task lifecycle', () => {
  it('carries an ark task from submit through a running fetch to a written mp4', async () => {
    let fetches = 0
    vi.stubGlobal(
      'fetch',
      router([
        [/^POST .*\/contents\/generations\/tasks$/, () => json({ id: 'cgt-1' })],
        [
          /^GET .*\/contents\/generations\/tasks\/cgt-1$/,
          () =>
            ++fetches < 2
              ? json({ id: 'cgt-1', status: 'running' })
              : json({ id: 'cgt-1', status: 'succeeded', content: { video_url: 'https://cdn.example/v.mp4' } }),
        ],
        [/^GET https:\/\/cdn\.example\/v\.mp4$/, () => new Response(MP4, { headers: { 'content-type': 'video/mp4' } })],
      ]),
    )

    const { taskId } = await submitVideoTask({
      provider: ARK,
      model: 'doubao-seedance-2-0-260128',
      prompt: 'a cat',
      duration: 5,
    })
    expect(taskId).toBe('cgt-1')

    expect((await fetchVideoTask(ARK, 'm', taskId)).status).toBe('running')
    const task = await fetchVideoTask(ARK, 'm', taskId)
    expect(task.status).toBe('succeeded')

    const dir = outDir()
    const saved = await persistVideoTask(ARK, 'm', task, { outputDir: dir, generationId: 'gen-1' })

    expect(saved[0].path).toBe(join(dir, 'gen-1-0.mp4'))
    expect(readFileSync(saved[0].path)).toEqual(Buffer.from(MP4))
    // Videos skip the base64 copy images keep.
    expect(saved[0].base64).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('reports an ark task failure as a failed task rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      router([
        [/^GET .*\/tasks\/cgt-2$/, () => json({ id: 'cgt-2', status: 'failed', error: { message: 'content filtered' } })],
      ]),
    )

    const task = await fetchVideoTask(ARK, 'm', 'cgt-2')

    expect(task.status).toBe('failed')
    expect(task.error).toMatch(/content filtered/)
    vi.unstubAllGlobals()
  })

  it('carries a sora task from submit through content download', async () => {
    vi.stubGlobal(
      'fetch',
      router([
        [/^POST .*\/videos$/, () => json({ id: 'vid_1', status: 'queued' })],
        [/^GET .*\/videos\/vid_1$/, () => json({ id: 'vid_1', status: 'completed' })],
        [/^GET .*\/videos\/vid_1\/content$/, () => new Response(MP4)],
      ]),
    )

    const { taskId } = await submitVideoTask({
      provider: SORA,
      model: 'sora-2',
      prompt: 'a dog',
      resolution: '1280x720',
      duration: 8,
    })
    const task = await fetchVideoTask(SORA, 'sora-2', taskId)
    const dir = outDir()
    const saved = await persistVideoTask(SORA, 'sora-2', task, { outputDir: dir, generationId: 'gen-2' })

    expect(readdirSync(dir)).toEqual(['gen-2-0.mp4'])
    expect(readFileSync(saved[0].path)).toEqual(Buffer.from(MP4))
    vi.unstubAllGlobals()
  })

  it('warns rather than fails when sora is given a size it does not support', async () => {
    vi.stubGlobal('fetch', router([[/^POST .*\/videos$/, () => json({ id: 'vid_2', status: 'queued' })]]))

    const { warnings } = await submitVideoTask({
      provider: SORA,
      model: 'sora-2',
      prompt: 'x',
      resolution: '9999x9999',
    })

    expect(warnings).toContainEqual(expect.objectContaining({ feature: 'resolution' }))
    vi.unstubAllGlobals()
  })
})
