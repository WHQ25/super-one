import { describe, it, expect, vi } from 'vitest'
import {
  attachImagePreviews,
  needsImagePreview,
  previewPathFor,
  writeImagePreview,
  PREVIEW_MAX_SIDE,
  PREVIEW_MAX_BYTES,
  type ImagePreviewDeps,
} from './image-preview'

function makeImage(width: number, height: number, jpeg: Buffer = Buffer.from('jpeg-bytes')) {
  const resize = vi.fn(() => makeImage(Math.min(width, PREVIEW_MAX_SIDE), Math.min(height, PREVIEW_MAX_SIDE), jpeg).image)
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize,
    toJPEG: () => jpeg,
  }
  return { image, resize }
}

function makeDeps(overrides: Partial<ImagePreviewDeps> & { width?: number; height?: number; bytes?: number; jpeg?: Buffer } = {}): ImagePreviewDeps & { written: { path: string; data: Buffer }[] } {
  const width = overrides.width ?? 4000
  const height = overrides.height ?? 3000
  const bytes = overrides.bytes ?? 20 * 1024 * 1024
  const jpeg = overrides.jpeg ?? Buffer.from('preview-jpeg')
  const { image } = makeImage(width, height, jpeg)
  const written: { path: string; data: Buffer }[] = []
  return {
    createFromPath: overrides.createFromPath ?? (() => image),
    statSize: overrides.statSize ?? (() => bytes),
    writeAtomic: overrides.writeAtomic ?? ((path, data) => { written.push({ path, data }) }),
    written,
  }
}

describe('needsImagePreview', () => {
  it('is false for small, light images', () => {
    expect(needsImagePreview(800, 600, 100_000)).toBe(false)
  })

  it('is true when either side exceeds the max', () => {
    expect(needsImagePreview(PREVIEW_MAX_SIDE + 1, 100, 1000)).toBe(true)
    expect(needsImagePreview(100, PREVIEW_MAX_SIDE + 1, 1000)).toBe(true)
  })

  it('is true when the file is heavier than the byte budget', () => {
    expect(needsImagePreview(800, 600, PREVIEW_MAX_BYTES + 1)).toBe(true)
  })
})

describe('previewPathFor', () => {
  it('writes a sibling .preview.jpg next to the original', () => {
    expect(previewPathFor('/tmp/gen/abc-0.png')).toBe('/tmp/gen/abc-0.preview.jpg')
    expect(previewPathFor('/tmp/gen/abc-0.jpg')).toBe('/tmp/gen/abc-0.preview.jpg')
  })
})

describe('writeImagePreview', () => {
  it('returns the original path when no preview is needed', () => {
    const deps = makeDeps({ width: 640, height: 480, bytes: 50_000 })
    expect(writeImagePreview('/tmp/small.png', deps)).toBe('/tmp/small.png')
    expect(deps.written).toHaveLength(0)
  })

  it('writes a downscaled JPEG for oversized dimensions', () => {
    const deps = makeDeps({ width: 5504, height: 3072, bytes: 18 * 1024 * 1024 })
    const preview = writeImagePreview('/tmp/gen/uuid-0.png', deps)
    expect(preview).toBe('/tmp/gen/uuid-0.preview.jpg')
    expect(deps.written).toHaveLength(1)
    expect(deps.written[0].path).toBe('/tmp/gen/uuid-0.preview.jpg')
    expect(deps.written[0].data.equals(Buffer.from('preview-jpeg'))).toBe(true)
  })

  it('re-encodes without resize when only the byte budget is exceeded', () => {
    const { image, resize } = makeImage(800, 600)
    const deps = makeDeps({
      width: 800,
      height: 600,
      bytes: PREVIEW_MAX_BYTES + 1,
      createFromPath: () => image,
    })
    const preview = writeImagePreview('/tmp/heavy.png', deps)
    expect(preview).toBe('/tmp/heavy.preview.jpg')
    expect(deps.written).toHaveLength(1)
    expect(resize).not.toHaveBeenCalled()
  })

  it('falls back to the original when the image cannot be decoded', () => {
    const deps = makeDeps({
      createFromPath: () => ({
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
        resize: () => {
          throw new Error('unreachable')
        },
        toJPEG: () => Buffer.alloc(0),
      }),
    })
    expect(writeImagePreview('/tmp/broken.png', deps)).toBe('/tmp/broken.png')
    expect(deps.written).toHaveLength(0)
  })
})

describe('attachImagePreviews', () => {
  it('sets previewPath on each saved image', () => {
    const deps = makeDeps({ width: 4000, height: 2000, bytes: 10 * 1024 * 1024 })
    const out = attachImagePreviews(
      [{ path: '/tmp/a.png', mediaType: 'image/png' }, { path: '/tmp/b.png', mediaType: 'image/png' }],
      deps,
    )
    expect(out.map((i) => i.previewPath)).toEqual(['/tmp/a.preview.jpg', '/tmp/b.preview.jpg'])
    expect(out.map((i) => i.path)).toEqual(['/tmp/a.png', '/tmp/b.png'])
  })

  it('reuses path as previewPath when the original is already small', () => {
    const deps = makeDeps({ width: 400, height: 300, bytes: 10_000 })
    const out = attachImagePreviews([{ path: '/tmp/tiny.png', mediaType: 'image/png' }], deps)
    expect(out[0].previewPath).toBe('/tmp/tiny.png')
  })
})
