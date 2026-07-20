import { mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { generateVideoMedia } from './service'
import type { MediaProviderConfig } from '../types'

/** Collapses the poll interval so tests exercise the loop without waiting on it. */
const FAST = { intervalMs: 0, maxIntervalMs: 0 }

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

describe('generateVideoMedia', () => {
  it('drives ark through submit, poll and download, then writes an mp4', async () => {
    let polls = 0
    const fetchMock = router([
      [/^POST .*\/contents\/generations\/tasks$/, () => json({ id: 'cgt-1' })],
      [
        /^GET .*\/contents\/generations\/tasks\/cgt-1$/,
        () =>
          ++polls < 3
            ? json({ id: 'cgt-1', status: 'running' })
            : json({ id: 'cgt-1', status: 'succeeded', content: { video_url: 'https://cdn.example/v.mp4' } }),
      ],
      [/^GET https:\/\/cdn\.example\/v\.mp4$/, () => new Response(MP4, { headers: { 'content-type': 'video/mp4' } })],
    ])
    vi.stubGlobal('fetch', fetchMock)

    const dir = outDir()
    const result = await generateVideoMedia(
      { provider: ARK, model: 'doubao-seedance-2-0-260128', prompt: 'a cat', duration: 5, poll: FAST },
      { outputDir: dir, generationId: 'gen-1' },
    )

    expect(polls).toBe(3)
    expect(result.images).toHaveLength(1)
    expect(result.images[0].path).toBe(join(dir, 'gen-1-0.mp4'))
    expect(readFileSync(result.images[0].path)).toEqual(Buffer.from(MP4))
    // Videos skip the base64 copy images keep.
    expect(result.images[0].base64).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('surfaces an ark task failure as a thrown error rather than an empty result', async () => {
    vi.stubGlobal(
      'fetch',
      router([
        [/^POST .*\/tasks$/, () => json({ id: 'cgt-2' })],
        [/^GET .*\/tasks\/cgt-2$/, () => json({ id: 'cgt-2', status: 'failed', error: { message: 'content filtered' } })],
      ]),
    )
    await expect(
      generateVideoMedia({ provider: ARK, model: 'm', prompt: 'x', poll: FAST }, { outputDir: outDir(), generationId: 'g' }),
    ).rejects.toThrow(/content filtered/)
    vi.unstubAllGlobals()
  })

  it('drives sora through create, poll and content download', async () => {
    let polls = 0
    vi.stubGlobal(
      'fetch',
      router([
        [/^POST .*\/videos$/, () => json({ id: 'vid_1', status: 'queued' })],
        [
          /^GET .*\/videos\/vid_1$/,
          () => (++polls < 2 ? json({ id: 'vid_1', status: 'in_progress' }) : json({ id: 'vid_1', status: 'completed' })),
        ],
        [/^GET .*\/videos\/vid_1\/content$/, () => new Response(MP4)],
      ]),
    )

    const dir = outDir()
    const result = await generateVideoMedia(
      { provider: SORA, model: 'sora-2', prompt: 'a dog', resolution: '1280x720', duration: 8, poll: FAST },
      { outputDir: dir, generationId: 'gen-2' },
    )

    expect(readdirSync(dir)).toEqual(['gen-2-0.mp4'])
    expect(readFileSync(result.images[0].path)).toEqual(Buffer.from(MP4))
    vi.unstubAllGlobals()
  })

  it('warns rather than fails when sora is given a size it does not support', async () => {
    vi.stubGlobal(
      'fetch',
      router([
        [/^POST .*\/videos$/, () => json({ id: 'vid_2', status: 'completed' })],
        [/^GET .*\/videos\/vid_2$/, () => json({ id: 'vid_2', status: 'completed' })],
        [/^GET .*\/videos\/vid_2\/content$/, () => new Response(MP4)],
      ]),
    )
    const result = await generateVideoMedia(
      { provider: SORA, model: 'sora-2', prompt: 'x', resolution: '9999x9999', poll: FAST },
      { outputDir: outDir(), generationId: 'g' },
    )
    expect(result.warnings).toContainEqual(expect.objectContaining({ feature: 'resolution' }))
    vi.unstubAllGlobals()
  })
})
