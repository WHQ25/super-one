/**
 * Sizing the `@native/files-previewer` stage to its content, shared by the
 * desktop card and the phone's. Each platform decides which kinds it can
 * measure; both size the stage to the tallest slide so paging never reflows
 * the transcript.
 */

export interface MediaSize { width: number; height: number }

/** Reads an image's natural size without mounting it; `null` when it does not decode. */
export function probeImageSize(url: string): { promise: Promise<MediaSize | null>; cancel: () => void } {
  const img = new Image()
  const promise = new Promise<MediaSize | null>((resolve) => {
    img.onload = () => resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    img.onerror = () => resolve(null)
  })
  img.src = url
  return { promise, cancel: () => { img.onload = null; img.onerror = null; img.src = '' } }
}

/**
 * The tallest slide at `width`, never below `floor`. Media render at most at
 * natural size (`max-w-full`), so a slide is its natural height scaled down to
 * fit; a `null` size is a slide that shows a chip or an error card, which the
 * floor already fits.
 */
export function fitPreviewerStageHeight(sizes: readonly (MediaSize | null)[], width: number, floor: number): number {
  const heights = sizes.map((size) => (size ? size.height * Math.min(1, width / size.width) : 0))
  return Math.ceil(Math.max(floor, ...heights))
}
