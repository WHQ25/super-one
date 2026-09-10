import { describe, expect, it } from 'vitest'
import {
  DOUBLE_TAP_SCALE,
  IDENTITY_TRANSFORM,
  MAX_SCALE,
  clampTranslate,
  doubleTapTransform,
  fitImage,
  imagePreviewFileName,
  isPreviewableImageSource,
  parseImageDataUri,
  pinchTransform,
  settleTransform,
} from './image-preview-state'

const viewport = { width: 400, height: 800 }

describe('image preview sources', () => {
  it('accepts inline image bytes and public URLs only', () => {
    expect(isPreviewableImageSource('data:image/png;base64,AA==')).toBe(true)
    expect(isPreviewableImageSource('https://example.com/a.png')).toBe(true)
    expect(isPreviewableImageSource('file:///tmp/a.png')).toBe(false)
    expect(isPreviewableImageSource('data:application/pdf;base64,AA==')).toBe(false)
  })

  it('splits an image data URI and rejects anything else', () => {
    expect(parseImageDataUri('data:image/PNG;base64,iVBOR w0KGgo=')).toEqual({ mimeType: 'image/png', base64: 'iVBORw0KGgo=' })
    expect(parseImageDataUri('https://example.com/a.png')).toBeNull()
    expect(parseImageDataUri('data:image/png,notbase64')).toBeNull()
  })

  it('names a shared copy from the path, then a file-like label, then the mime type', () => {
    expect(imagePreviewFileName({ src: '', path: '/Users/me/shots/Screen: 1.png' }, 'image/png')).toBe('Screen_ 1.png')
    expect(imagePreviewFileName({ src: '', label: 'photo.jpeg' }, 'image/jpeg')).toBe('photo.jpeg')
    expect(imagePreviewFileName({ src: '', label: 'Screenshot' }, 'image/jpeg')).toBe('image.jpg')
    expect(imagePreviewFileName({ src: '' }, 'image/x-unknown')).toBe('image.img')
  })
})

describe('image preview geometry', () => {
  it('fits the picture inside the viewport keeping its aspect', () => {
    expect(fitImage(viewport, { width: 2000, height: 1000 })).toEqual({ width: 400, height: 200 })
    expect(fitImage(viewport, { width: 100, height: 400 })).toEqual({ width: 200, height: 800 })
    expect(fitImage(viewport, { width: 0, height: 0 })).toEqual(viewport)
  })

  it('keeps a zoomed picture covering the viewport and a fitted one centred', () => {
    const fitted = { width: 400, height: 200 }
    expect(clampTranslate({ x: 500, y: 500 }, 2, viewport, fitted)).toEqual({ x: 200, y: 0 })
    expect(clampTranslate({ x: -50, y: 30 }, 1, viewport, fitted)).toEqual({ x: 0, y: 0 })
  })

  it('pinches around the fingers so the point under them stays put', () => {
    const start = { ...IDENTITY_TRANSFORM, focal: { x: 100, y: 50 }, distance: 100 }
    const next = pinchTransform(start, { focal: { x: 100, y: 50 }, distance: 200 })
    expect(next.scale).toBe(2)
    // Picture point under the focal was (100, 50); at scale 2 it must still land there.
    expect(next.translate.x + next.scale * 100).toBeCloseTo(100)
    expect(next.translate.y + next.scale * 50).toBeCloseTo(50)
  })

  it('lets a pinch overshoot elastically and settles back inside the limits', () => {
    const fitted = { width: 400, height: 200 }
    const start = { ...IDENTITY_TRANSFORM, focal: { x: 0, y: 0 }, distance: 10 }
    const over = pinchTransform(start, { focal: { x: 0, y: 0 }, distance: 1000 })
    expect(over.scale).toBeGreaterThan(MAX_SCALE)
    expect(settleTransform(over, viewport, fitted).scale).toBe(MAX_SCALE)
    const under = pinchTransform(start, { focal: { x: 0, y: 0 }, distance: 5 })
    expect(under.scale).toBeLessThan(1)
    expect(settleTransform(under, viewport, fitted)).toEqual(IDENTITY_TRANSFORM)
  })

  it('double tap zooms in on the tap and a second one restores the fit', () => {
    const fitted = { width: 400, height: 800 }
    const zoomed = doubleTapTransform(IDENTITY_TRANSFORM, { x: 100, y: -200 }, viewport, fitted)
    expect(zoomed.scale).toBe(DOUBLE_TAP_SCALE)
    expect(zoomed.translate.x + zoomed.scale * 100).toBeCloseTo(100)
    expect(zoomed.translate.y + zoomed.scale * -200).toBeCloseTo(-200)
    expect(doubleTapTransform(zoomed, { x: 0, y: 0 }, viewport, fitted)).toEqual(IDENTITY_TRANSFORM)
  })

  it('double tap near an edge is clamped so no gap opens', () => {
    const fitted = { width: 400, height: 800 }
    const zoomed = doubleTapTransform(IDENTITY_TRANSFORM, { x: 200, y: 400 }, viewport, fitted)
    const maxX = (fitted.width * zoomed.scale - viewport.width) / 2
    expect(Math.abs(zoomed.translate.x)).toBeLessThanOrEqual(maxX + 1e-9)
  })
})
