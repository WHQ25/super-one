import type { Rect } from './mosaic-tree'

/** Actual on-screen rect of a tile, relative to `container`'s top-left. Null if not mounted yet. */
export function leafRectRel(container: HTMLElement, id: string): Rect | null {
  const el = container.querySelector(`[data-tile-id="${CSS.escape(id)}"]`)
  if (!el) return null
  const c = container.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height }
}

/** Bounding union of several tiles' actual rects (container-relative). Null if none are mounted. */
export function unionLeafRectRel(container: HTMLElement, ids: string[]): Rect | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const id of ids) {
    const r = leafRectRel(container, id)
    if (!r) continue
    left = Math.min(left, r.x)
    top = Math.min(top, r.y)
    right = Math.max(right, r.x + r.w)
    bottom = Math.max(bottom, r.y + r.h)
  }
  if (left === Infinity) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}
