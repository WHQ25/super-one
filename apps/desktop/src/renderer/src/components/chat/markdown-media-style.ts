import type { CSSProperties } from 'react'

/**
 * Default for agent-produced media: a block preview clamped to the column and
 * sized from its own pixels. Markdown's `![…](…)` carries no dimensions, so
 * this is everything we know about such an image.
 */
export const MEDIA_STYLE: CSSProperties = {
  maxHeight: '20rem',
  maxWidth: '100%',
  width: 'auto',
  height: 'auto',
  borderRadius: '8px',
  display: 'block',
}

/**
 * READMEs size inline icons and badges with HTML (`<img width="16">`), and the
 * defaults above quietly ignore that: an inline `width: auto` outranks the
 * width attribute's presentational hint, so a 16px icon renders at its natural
 * size on a line of its own. An authored dimension therefore opts the image
 * back into plain inline sizing — the way GitHub renders it — and the axis the
 * author left out stays `auto` to keep the aspect ratio.
 */
export function mediaStyleFor(
  width: string | number | undefined,
  height: string | number | undefined,
): CSSProperties {
  if (width == null && height == null) return MEDIA_STYLE
  return {
    maxWidth: '100%',
    width: width == null ? 'auto' : undefined,
    height: height == null ? 'auto' : undefined,
    verticalAlign: 'middle',
  }
}
