/** Painted thumbnail width. The viewer scales a slide to this width, so the rail must not be narrower. */
export const PPTX_THUMB_WIDTH = 128

const THUMB_ROW_GAP = 8

/** Slide width divided by slide height. Widescreen decks are about 16/9. */
export function pptxThumbCanvasHeight(aspect: number): number {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  return Math.max(1, Math.ceil(PPTX_THUMB_WIDTH / safe))
}

export function pptxThumbRowHeight(aspect: number): number {
  return pptxThumbCanvasHeight(aspect) + THUMB_ROW_GAP
}

/** Decks this size mount every thumbnail. Larger decks window by scroll position. */
export const PPTX_THUMB_MOUNT_ALL = 24

/** Inclusive-exclusive indexes to mount. Scroll 0 always includes the first slide. */
export function pptxThumbnailWindow(
  count: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  overscan = 3,
): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0 || viewport <= 0) return { start: 0, end: 0 }
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight) + overscan)
  return { start, end }
}

/** Indexes that must be in the DOM. A short deck is never reduced to the last slides. */
export function pptxThumbnailIndexes(
  count: number,
  scrollTop: number,
  viewport: number,
  rowHeight: number,
): number[] {
  if (count <= 0) return []
  if (count <= PPTX_THUMB_MOUNT_ALL) return Array.from({ length: count }, (_, index) => index)
  const { start, end } = pptxThumbnailWindow(count, scrollTop, viewport, rowHeight)
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset)
}
