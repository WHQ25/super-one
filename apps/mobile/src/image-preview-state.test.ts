import { describe, expect, it } from 'vitest'
import {
  DOUBLE_TAP_SCALE,
  IDENTITY_TRANSFORM,
  MAX_SCALE,
  angleDelta,
  clampTranslate,
  doubleTapTransform,
  fitImage,
  imagePreviewFileName,
  isPreviewableImageSource,
  parseImageDataUri,
  parseImageGenerationInfo,
  pinchTransform,
  quarterTurnTransform,
  rotatedFit,
  rotationFitScale,
  settleTransform,
  snapRotation,
} from './image-preview-state'

const viewport = { width: 400, height: 800 }

describe('generation info off the bridge', () => {
  it('keeps every well-formed field and nothing else', () => {
    expect(parseImageGenerationInfo({
      revisedPrompt: 'astronaut',
      generationMs: 1200,
      params: [{ key: 'model', value: 'gpt-image-1' }, { key: 'size' }, 'junk'],
      referenceImagePaths: ['/refs/a.png'],
      warnings: ['rewritten'],
      extra: true,
    })).toEqual({
      revisedPrompt: 'astronaut',
      generationMs: 1200,
      params: [{ key: 'model', value: 'gpt-image-1' }],
      referenceImagePaths: ['/refs/a.png'],
      warnings: ['rewritten'],
    })
  })

  it('answers undefined when nothing survives, so no info button appears', () => {
    expect(parseImageGenerationInfo(undefined)).toBeUndefined()
    expect(parseImageGenerationInfo('astronaut')).toBeUndefined()
    expect(parseImageGenerationInfo({ revisedPrompt: '', generationMs: -5, params: [], warnings: [1] })).toBeUndefined()
  })
})

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
    const fitted = { width: 400, height: 200 }
    const start = { ...IDENTITY_TRANSFORM, focal: { x: 100, y: 50 }, distance: 100, angle: 0 }
    const next = pinchTransform(start, { focal: { x: 100, y: 50 }, distance: 200, angle: 0 }, viewport, fitted)
    expect(next.scale).toBe(2)
    // Picture point under the focal was (100, 50); at scale 2 it must still land there.
    expect(next.translate.x + next.scale * 100).toBeCloseTo(100)
    expect(next.translate.y + next.scale * 50).toBeCloseTo(50)
  })

  it('lets a pinch overshoot elastically and settles back inside the limits', () => {
    const fitted = { width: 400, height: 200 }
    const start = { ...IDENTITY_TRANSFORM, focal: { x: 0, y: 0 }, distance: 10, angle: 0 }
    const over = pinchTransform(start, { focal: { x: 0, y: 0 }, distance: 1000, angle: 0 }, viewport, fitted)
    expect(over.scale).toBeGreaterThan(MAX_SCALE)
    expect(settleTransform(over, viewport, fitted).scale).toBe(MAX_SCALE)
    const under = pinchTransform(start, { focal: { x: 0, y: 0 }, distance: 5, angle: 0 }, viewport, fitted)
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

describe('image preview rotation', () => {
  // A portrait picture filling a portrait viewport: on its side it has to shrink.
  const portrait = { width: 400, height: 800 }
  const landscape = { width: 400, height: 200 }

  it('leaves an upright picture alone and refits a turned one', () => {
    expect(rotationFitScale(0, viewport, portrait)).toBe(1)
    expect(rotationFitScale(180, viewport, portrait)).toBeCloseTo(1)
    // Laid on its side the 800 pt edge has 400 pt of width to live in.
    expect(rotationFitScale(90, viewport, portrait)).toBeCloseTo(0.5)
    // A wide picture stood on its end grows into the height it now has.
    expect(rotationFitScale(90, viewport, landscape)).toBeCloseTo(2)
  })

  it('reports the turned on-screen box, which is what the pan clamp measures', () => {
    expect(rotatedFit(0, viewport, portrait)).toEqual(portrait)
    const sideways = rotatedFit(90, viewport, portrait)
    expect(sideways.width).toBeCloseTo(400)
    expect(sideways.height).toBeCloseTo(200)
    // Whatever the angle, the box never leaves the viewport.
    for (const angle of [17, 45, 63, 128, 271]) {
      const box = rotatedFit(angle, viewport, portrait)
      expect(box.width).toBeLessThanOrEqual(viewport.width + 1e-9)
      expect(box.height).toBeLessThanOrEqual(viewport.height + 1e-9)
    }
  })

  it('turns around the fingers and settles on the nearest quarter', () => {
    const start = { ...IDENTITY_TRANSFORM, focal: { x: 0, y: 0 }, distance: 100, angle: 10 }
    const turned = pinchTransform(start, { focal: { x: 0, y: 0 }, distance: 100, angle: 100 }, viewport, portrait)
    expect(turned.rotation).toBeCloseTo(90)
    expect(settleTransform(turned, viewport, portrait).rotation).toBe(90)
    // A gesture abandoned short of halfway falls back to where it started.
    const nudged = pinchTransform(start, { focal: { x: 0, y: 0 }, distance: 100, angle: 40 }, viewport, portrait)
    expect(settleTransform(nudged, viewport, portrait).rotation).toBe(0)
  })

  it('takes the shortest way round when the fingers cross the ±180° seam', () => {
    expect(angleDelta(170, -170)).toBe(20)
    expect(angleDelta(-170, 170)).toBe(-20)
    expect(snapRotation(-46)).toBe(-90)
    expect(snapRotation(44)).toBe(0)
  })

  it('keeps a settled rotation through a zoom, a pan and a double tap', () => {
    const turned = { scale: 1, translate: { x: 0, y: 0 }, rotation: 90 }
    expect(settleTransform({ ...turned, scale: 9 }, viewport, portrait).rotation).toBe(90)
    expect(doubleTapTransform(turned, { x: 0, y: 0 }, viewport, portrait).rotation).toBe(90)
  })

  it('clamps a zoomed turned picture against its turned box, not its upright one', () => {
    const turned = { scale: 2, translate: { x: 1000, y: 1000 }, rotation: 90 }
    const settled = settleTransform(turned, viewport, portrait)
    const box = rotatedFit(90, viewport, portrait)
    expect(settled.translate.x).toBeCloseTo((box.width * 2 - viewport.width) / 2)
    // Sideways the picture is 400 pt tall against an 800 pt screen even at 2×,
    // so it stays centred vertically — the upright box would have panned here.
    expect(box.height * 2).toBeLessThan(viewport.height)
    expect(settled.translate.y).toBe(0)
  })

  it('the rotate buttons step whole quarters from wherever the picture rests', () => {
    expect(quarterTurnTransform(IDENTITY_TRANSFORM, 1).rotation).toBe(90)
    expect(quarterTurnTransform(IDENTITY_TRANSFORM, -1).rotation).toBe(-90)
    // A press mid-gesture snaps first, so four presses are always a full turn.
    expect(quarterTurnTransform({ scale: 3, translate: { x: 40, y: 5 }, rotation: 88 }, 1))
      .toEqual({ scale: 1, translate: { x: 0, y: 0 }, rotation: 180 })
  })
})
