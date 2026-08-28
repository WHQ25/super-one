import { describe, expect, it } from 'vitest'
import { fitScreenshotWidth, MAX_SCREENSHOT_WIDTH } from './screenshot-fit'

describe('screenshot width fitting', () => {
  it('leaves a 2x capture of an ordinary viewport untouched', () => {
    // 748 CSS px at devicePixelRatio 2 — the case that used to be resampled x0.856.
    expect(fitScreenshotWidth(1496)).toBeNull()
    expect(fitScreenshotWidth(1200)).toBeNull()
  })

  it('leaves a capture exactly at the cap untouched', () => {
    expect(fitScreenshotWidth(MAX_SCREENSHOT_WIDTH)).toBeNull()
  })

  it('halves a 2x capture of a wide viewport to exactly 1x', () => {
    expect(fitScreenshotWidth(3200)).toBe(1600)
    expect(fitScreenshotWidth(2560)).toBe(1280)
  })

  it('steps down by whole factors on very large captures', () => {
    expect(fitScreenshotWidth(5000)).toBe(1250)
    expect(fitScreenshotWidth(8000)).toBe(1600)
  })

  it('never returns a width above the cap', () => {
    for (let w = 1; w <= 6000; w += 7) {
      const fitted = fitScreenshotWidth(w)
      if (fitted !== null) expect(fitted).toBeLessThanOrEqual(MAX_SCREENSHOT_WIDTH)
    }
  })

  // The whole point: the reduction ratio must sit on (or within rounding of) an
  // integer, never on something like 1.17 that lands glyph edges between pixels.
  it('only ever reduces by a whole factor', () => {
    for (let w = 1; w <= 6000; w += 7) {
      const fitted = fitScreenshotWidth(w)
      if (fitted === null) continue
      const factor = w / fitted
      expect(Math.abs(factor - Math.round(factor))).toBeLessThan(0.01)
    }
  })

  it('ignores degenerate sizes rather than dividing by zero', () => {
    expect(fitScreenshotWidth(0)).toBeNull()
    expect(fitScreenshotWidth(-1)).toBeNull()
    expect(fitScreenshotWidth(Number.NaN)).toBeNull()
  })
})
