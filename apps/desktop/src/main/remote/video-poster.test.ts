import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVideoPosterService, type VideoPoster } from './video-poster'

const POSTER: VideoPoster = { base64: 'ZnJhbWU=', mimeType: 'image/jpeg', width: 512, height: 288, durationMs: 27_051 }
const clip = (realPath: string, modifiedAt = 1_000) => ({ realPath, size: 4096, modifiedAt })

const dirs: string[] = []
function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'video-poster-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('video posters for the phone transcript', () => {
  it('cuts a clip once and answers later asks, and later processes, from disk', async () => {
    const dir = cacheDir()
    const render = vi.fn(async () => POSTER)
    const service = createVideoPosterService({ cacheDirectory: dir, renderer: { render } })
    await expect(service.posterFor(clip('/proj/out/a.mp4'))).resolves.toEqual(POSTER)
    await expect(service.posterFor(clip('/proj/out/a.mp4'))).resolves.toEqual(POSTER)
    expect(render).toHaveBeenCalledTimes(1)
    // A fresh service over the same directory is the app after a restart.
    const restarted = createVideoPosterService({ cacheDirectory: dir, renderer: { render } })
    await expect(restarted.posterFor(clip('/proj/out/a.mp4'))).resolves.toEqual(POSTER)
    expect(render).toHaveBeenCalledTimes(1)
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('cuts again when the file changed under the same path', async () => {
    const render = vi.fn(async () => POSTER)
    const service = createVideoPosterService({ cacheDirectory: cacheDir(), renderer: { render } })
    await service.posterFor(clip('/proj/out/a.mp4', 1_000))
    await service.posterFor(clip('/proj/out/a.mp4', 2_000))
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('remembers a clip it could not decode instead of retrying on every open', async () => {
    const render = vi.fn(async () => null)
    const service = createVideoPosterService({ cacheDirectory: cacheDir(), renderer: { render } })
    await expect(service.posterFor(clip('/proj/out/odd.mkv'))).resolves.toBeNull()
    await expect(service.posterFor(clip('/proj/out/odd.mkv'))).resolves.toBeNull()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight cut between concurrent asks for the same clip', async () => {
    let release!: (poster: VideoPoster) => void
    const render = vi.fn(() => new Promise<VideoPoster>((resolve) => { release = resolve }))
    const service = createVideoPosterService({ cacheDirectory: cacheDir(), renderer: { render } })
    const first = service.posterFor(clip('/proj/out/a.mp4'))
    const second = service.posterFor(clip('/proj/out/a.mp4'))
    expect(render).toHaveBeenCalledTimes(1)
    release(POSTER)
    await expect(Promise.all([first, second])).resolves.toEqual([POSTER, POSTER])
  })

  it('does not let a renderer failure poison the cache', async () => {
    const render = vi.fn<() => Promise<VideoPoster | null>>()
      .mockRejectedValueOnce(new Error('window crashed'))
      .mockResolvedValueOnce(POSTER)
    const service = createVideoPosterService({ cacheDirectory: cacheDir(), renderer: { render } })
    await expect(service.posterFor(clip('/proj/out/a.mp4'))).rejects.toThrow('window crashed')
    await expect(service.posterFor(clip('/proj/out/a.mp4'))).resolves.toEqual(POSTER)
  })
})
