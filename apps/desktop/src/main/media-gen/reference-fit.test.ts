import { describe, expect, it, vi } from 'vitest'
import { referenceImageLimits } from './capabilities'
import { fitReferenceImages, type FitNativeImage } from './reference-fit'

const MB = 1024 * 1024

/** A fake image whose encoded size scales with its pixel count. */
function fakeImage(width: number, height: number, bytesPerPixel = 0.5): FitNativeImage {
  const encode = (factor: number) => Buffer.alloc(Math.ceil(width * height * bytesPerPixel * factor))
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }) => fakeImage(w, h, bytesPerPixel),
    toPNG: () => encode(2),
    toJPEG: () => encode(1),
  }
}

const bytes = (size: number) => new Uint8Array(size)

describe('fitReferenceImages', () => {
  it('passes images within every limit through untouched and without decoding', () => {
    const decode = vi.fn()
    const image = { mediaType: 'image/png', data: bytes(MB) }
    expect(fitReferenceImages([image], { maxBytes: 50 * MB }, decode)[0]).toBe(image)
    expect(decode).not.toHaveBeenCalled()
  })

  it('shrinks to the pixel cap and keeps PNG when it fits', () => {
    const decode = vi.fn(() => fakeImage(8000, 6000, 0.1))
    const [fitted] = fitReferenceImages([{ mediaType: 'image/png', data: bytes(9 * MB) }], { maxBytes: 30 * MB, maxPixels: 36_000_000 }, decode)
    expect(fitted!.mediaType).toBe('image/png')
    // 6928×5196 at 0.2 bytes per PNG pixel.
    expect(fitted!.data.byteLength).toBeLessThanOrEqual(36_000_000 * 0.2)
  })

  it('falls back to JPEG and keeps shrinking until the byte budget holds', () => {
    const decode = vi.fn(() => fakeImage(4000, 4000, 2))
    const [fitted] = fitReferenceImages([{ mediaType: 'image/png', data: bytes(40 * MB) }], { maxBytes: 10 * MB }, decode)
    expect(fitted!.mediaType).toBe('image/jpeg')
    expect(fitted!.data.byteLength).toBeLessThanOrEqual(10 * MB)
  })

  it('splits a capped request body across its images', () => {
    const decode = vi.fn(() => fakeImage(4000, 3000, 1))
    const images = [0, 1, 2].map(() => ({ mediaType: 'image/jpeg', data: bytes(20 * MB) }))
    const fitted = fitReferenceImages(images, { maxBytes: 30 * MB, maxTotalBytes: 46 * MB }, decode)
    expect(fitted.reduce((sum, image) => sum + image.data.byteLength, 0)).toBeLessThanOrEqual(46 * MB)
  })

  it('leaves formats Electron cannot decode to the provider', () => {
    const image = { mediaType: 'image/webp', data: bytes(20 * MB) }
    const empty = { ...fakeImage(1, 1), isEmpty: () => true }
    expect(fitReferenceImages([image], { maxBytes: 10 * MB }, () => empty)[0]).toBe(image)
  })
})

describe('referenceImageLimits', () => {
  it('follows the official model limits by model id, relays included', () => {
    expect(referenceImageLimits('gpt-image-1')).toEqual({ maxBytes: 50 * MB })
    expect(referenceImageLimits('doubao-seedream-4-0-250828')).toMatchObject({ maxBytes: 30 * MB, maxPixels: 36_000_000 })
    expect(referenceImageLimits('dreamina-seedance-2-0')).toMatchObject({ maxSide: 6000, maxTotalBytes: 46 * MB })
    expect(referenceImageLimits('kling-v2')).toEqual({ maxBytes: 10 * MB })
    expect(referenceImageLimits('some-relay-model')).toEqual({ maxBytes: 10 * MB, maxSide: 4096 })
  })
})
