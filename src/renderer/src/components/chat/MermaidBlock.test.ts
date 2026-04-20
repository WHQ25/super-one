import { describe, it, expect } from 'vitest'
import {
  MAX_H,
  OVERFLOW_THRESHOLD,
  OVERFLOW_RENDER_RATIO,
  parseSize,
  computeLayout,
} from './MermaidBlock'

describe('parseSize', () => {
  it('extracts width and height from viewBox', () => {
    const svg = '<svg viewBox="0 0 800 2000" xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(parseSize(svg)).toEqual({ w: 800, h: 2000 })
  })

  it('handles decimal viewBox values', () => {
    const svg = '<svg viewBox="0 0 843.878 2178.14"></svg>'
    expect(parseSize(svg)).toEqual({ w: 843.878, h: 2178.14 })
  })

  it('handles comma-separated viewBox values', () => {
    const svg = '<svg viewBox="0,0,800,600"></svg>'
    expect(parseSize(svg)).toEqual({ w: 800, h: 600 })
  })

  it('returns zero size when viewBox is missing', () => {
    expect(parseSize('<svg width="800" height="600"></svg>')).toEqual({ w: 0, h: 0 })
  })

  it('returns zero size for malformed viewBox', () => {
    expect(parseSize('<svg viewBox="abc def ghi jkl"></svg>')).toEqual({ w: 0, h: 0 })
  })
})

describe('computeLayout', () => {
  describe('invalid inputs', () => {
    it('returns default when containerW is zero (not yet measured)', () => {
      expect(computeLayout(800, 2000, 0)).toEqual({ overflow: false, overflowW: 0 })
    })
    it('returns default when svg dimensions are zero', () => {
      expect(computeLayout(0, 2000, 500)).toEqual({ overflow: false, overflowW: 0 })
      expect(computeLayout(800, 0, 500)).toEqual({ overflow: false, overflowW: 0 })
    })
  })

  describe('档 1: 自适应 — svg fits within max height after width-fit', () => {
    it('small svg', () => {
      // svg 400×300, container 500, widthScale=min(500/400,1)=1, scaledH=300 < MAX_H
      expect(computeLayout(400, 300, 500)).toEqual({ overflow: false, overflowW: 0 })
    })

    it('svg wider than container but short', () => {
      // svg 1000×400, container 500, widthScale=0.5, scaledH=200 < MAX_H
      expect(computeLayout(1000, 400, 500)).toEqual({ overflow: false, overflowW: 0 })
    })

    it('just at max height threshold', () => {
      // scaledH === MAX_H
      expect(computeLayout(500, 500, 500)).toEqual({ overflow: false, overflowW: 0 })
    })
  })

  describe('档 2: 压扁 — moderately tall, compress via CSS max-height', () => {
    it('tall but aspect ratio moderate — stays non-overflow (CSS max-h handles compression)', () => {
      // svg 600×1200, container 500, widthScale=min(500/600,1)=0.833, scaledH=1000 > MAX_H
      // fittedW = 600 * 500/1200 = 250, containerW * 0.3 = 150, 250 >= 150 → non-overflow
      expect(computeLayout(600, 1200, 500)).toEqual({ overflow: false, overflowW: 0 })
    })

    it('taller but still above OVERFLOW_THRESHOLD', () => {
      // svg 800×2000, container 500, fittedW = 800*500/2000 = 200, 200 >= 500*0.3=150 → non-overflow
      expect(computeLayout(800, 2000, 500)).toEqual({ overflow: false, overflowW: 0 })
    })

    it('at exact overflow threshold boundary — still fits (>=)', () => {
      // fittedW === containerW * OVERFLOW_THRESHOLD → non-overflow
      // Pick svgW/svgH such that fittedW = 150 exactly; svgW=300, svgH=1000 → fittedW=300*500/1000=150
      expect(computeLayout(300, 1000, 500)).toEqual({ overflow: false, overflowW: 0 })
    })
  })

  describe('档 3: 滚动 — extreme aspect ratio, switch to overflow scroll', () => {
    it('super tall narrow svg', () => {
      // svg 200×2000, container 500, widthScale=1, scaledH=2000 > MAX_H
      // fittedW = 200*500/2000 = 50, 50 < 150 → overflow
      const layout = computeLayout(200, 2000, 500)
      expect(layout.overflow).toBe(true)
      expect(layout.overflowW).toBe(500 * OVERFLOW_RENDER_RATIO) // 300
    })

    it('fittedW just below threshold', () => {
      // svgW=299, svgH=1000, fittedW = 299*500/1000 = 149.5 < 150 → overflow
      const layout = computeLayout(299, 1000, 500)
      expect(layout.overflow).toBe(true)
    })

    it('overflowW scales with container width', () => {
      const layout = computeLayout(200, 2000, 800)
      expect(layout.overflow).toBe(true)
      expect(layout.overflowW).toBeCloseTo(800 * OVERFLOW_RENDER_RATIO)
    })
  })

  describe('constants match original design', () => {
    it('MAX_H, OVERFLOW_THRESHOLD, OVERFLOW_RENDER_RATIO are stable', () => {
      expect(MAX_H).toBe(500)
      expect(OVERFLOW_THRESHOLD).toBe(0.3)
      expect(OVERFLOW_RENDER_RATIO).toBe(0.6)
    })
  })
})
