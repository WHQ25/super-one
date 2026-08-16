import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ImagePreviewDeps } from '../media-gen/image-preview'
import { buildNativeWidgetPayload } from './native-widget-payload'

/** Electron's nativeImage is the one true boundary here — everything else runs on a real temp dir. */
function stubPreviewDeps(): ImagePreviewDeps {
  return {
    // Reporting an empty image makes writeImagePreview return the original path untouched,
    // which is the "small enough, no downscale needed" branch.
    createFromPath: () => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
      resize: () => { throw new Error('unreachable') },
      toJPEG: () => Buffer.alloc(0),
    }),
    statSize: () => 1024,
    writeAtomic: () => { throw new Error('unreachable') },
    warn: () => {},
  }
}

describe('native widget payload', () => {
  let dir: string
  const deps = () => ({ outputDir: join(dir, 'out'), generationId: 'gen1', previewDeps: stubPreviewDeps() })

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'native-widget-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  describe('image-gallery', () => {
    it('writes agent-supplied bytes to disk so a custom provider adapter lands in the standard gallery', () => {
      const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
      const built = buildNativeWidgetPayload('image-gallery', 'seedream', {
        images: [{ base64: png, mediaType: 'image/png' }],
        prompt: 'a cat on a bike',
        params: { provider: 'my-provider', model: 'seedream-4' },
      }, deps())

      expect(built.error).toBeUndefined()
      const image = built.payload!.images![0]
      expect(existsSync(image.savedPath!)).toBe(true)
      expect(image.status).toBe('completed')
      expect(image.revisedPrompt).toBe('a cat on a bike')
      expect(image.params).toEqual([
        { key: 'provider', value: 'my-provider' },
        { key: 'model', value: 'seedream-4' },
      ])
    })

    it('passes through a path the agent already has on disk without copying it', () => {
      const existing = join(dir, 'already.png')
      writeFileSync(existing, 'x')
      const built = buildNativeWidgetPayload('image-gallery', 't', { images: [{ path: existing }] }, deps())
      expect(built.payload!.images![0].savedPath).toBe(existing)
    })

    it('accepts a mix of paths and bytes in one call, preserving order', () => {
      const existing = join(dir, 'first.png')
      writeFileSync(existing, 'x')
      const built = buildNativeWidgetPayload('image-gallery', 't', {
        images: [{ path: existing }, { base64: Buffer.from('ab').toString('base64') }],
      }, deps())
      const paths = built.payload!.images!.map((i) => i.savedPath)
      expect(paths[0]).toBe(existing)
      expect(paths[1]).not.toBe(existing)
      expect(built.payload!.images!.map((i) => i.id)).toEqual(['gen1-0', 'gen1-1'])
    })

    it('errors instead of emitting an empty gallery, which would hide the row and show nothing', () => {
      expect(buildNativeWidgetPayload('image-gallery', 't', { images: [] }, deps()).error).toMatch(/images/)
      expect(buildNativeWidgetPayload('image-gallery', 't', undefined, deps()).error).toMatch(/images/)
    })

    it('errors on a path that does not exist rather than rendering a broken thumb', () => {
      const built = buildNativeWidgetPayload('image-gallery', 't', { images: [{ path: join(dir, 'nope.png') }] }, deps())
      expect(built.error).toMatch(/nope\.png/)
      expect(built.payload).toBeUndefined()
    })

    it('names the offending index when an entry carries neither path nor base64', () => {
      const built = buildNativeWidgetPayload('image-gallery', 't', { images: [{ mediaType: 'image/png' }] }, deps())
      expect(built.error).toMatch(/images\[0\]/)
    })

    it('carries warnings through so provider caveats survive into the card', () => {
      const built = buildNativeWidgetPayload('image-gallery', 't', {
        images: [{ base64: Buffer.from('ab').toString('base64') }],
        warnings: ['seed ignored by this model'],
      }, deps())
      expect(built.payload!.images![0].warnings).toEqual(['seed ignored by this model'])
    })
  })

  describe('video-gallery', () => {
    it('persists bytes and uses the video prompt field rather than revisedPrompt', () => {
      const built = buildNativeWidgetPayload('video-gallery', 'clip', {
        videos: [{ base64: Buffer.from('mp4').toString('base64'), mediaType: 'video/mp4' }],
        prompt: 'a drone shot',
      }, deps())

      const video = built.payload!.videos![0]
      expect(existsSync(video.savedPath!)).toBe(true)
      expect(video.prompt).toBe('a drone shot')
      expect(video.type).toBe('video_generation')
      expect(built.payload!.images).toBeUndefined()
    })

    it('errors when videos is missing so the mistake is reported, not swallowed', () => {
      expect(buildNativeWidgetPayload('video-gallery', 't', { images: [] }, deps()).error).toMatch(/videos/)
    })
  })
})
