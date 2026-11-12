import { describe, expect, it } from 'vitest'
import {
  pptxThumbCanvasHeight,
  pptxThumbRowHeight,
  pptxThumbnailIndexes,
  pptxThumbnailWindow,
  PPTX_THUMB_WIDTH,
} from './office-pptx-thumbs'

describe('pptx thumbnail rail window', () => {
  it('keeps a 16:9 slide fully inside the fixed thumb width', () => {
    expect(pptxThumbCanvasHeight(16 / 9)).toBe(Math.ceil(PPTX_THUMB_WIDTH / (16 / 9)))
    expect(pptxThumbRowHeight(16 / 9)).toBe(pptxThumbCanvasHeight(16 / 9) + 8)
  })

  it('starts at the first slide when the rail has not scrolled', () => {
    const row = pptxThumbRowHeight(16 / 9)
    expect(pptxThumbnailWindow(10, 0, 240, row)).toEqual({ start: 0, end: Math.min(10, Math.ceil(240 / row) + 3) })
  })

  it('still includes slides above the last page when scrolled to the end', () => {
    const row = 100
    const window = pptxThumbnailWindow(10, 800, 200, row, 2)
    expect(window.start).toBeLessThan(8)
    expect(window.end).toBe(10)
    expect(window).toEqual({ start: 6, end: 10 })
  })

  it('keeps every slide of a short deck even when the scroll offset is past the end', () => {
    const indexes = pptxThumbnailIndexes(10, 9_999, 80, 80)
    expect(indexes[0]).toBe(0)
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('windows a long deck from the first slide until the rail scrolls', () => {
    const row = 80
    const indexes = pptxThumbnailIndexes(40, 0, 160, row)
    expect(indexes[0]).toBe(0)
    expect(indexes).not.toContain(39)
    expect(pptxThumbnailIndexes(40, 39 * row, 160, row)).toContain(39)
  })
})
