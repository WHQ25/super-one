import { firstLineTopRight, type ViewportCorner } from '@/components/chat/plan-annotation-dom'

export interface PinBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where a code-comment pin sits.
 *
 * The pin hangs on the top-right corner of the first code line. A longer
 * line below does not move it. A corner that has scrolled out of the
 * scroller sticks to that edge, so a long first line stays on screen.
 */
export function visiblePinPosition(
  rects: readonly DOMRectReadOnly[],
  visible: PinBox,
  pinSize: number,
): ViewportCorner | null {
  const corner = firstLineTopRight(rects, pinSize)
  const first = rects[0]
  if (!corner || !first) return null
  if (visible.width <= 0 || visible.height <= 0) return corner

  const visRight = visible.left + visible.width
  const visBottom = visible.top + visible.height
  const top = first.bottom <= visible.top ? visible.top : first.top >= visBottom ? visBottom : corner.top
  const maxLeft = Math.max(visible.left, visRight - pinSize)
  const maxTop = Math.max(visible.top, visBottom - pinSize)
  return {
    left: Math.min(Math.max(corner.left, visible.left), maxLeft),
    top: Math.min(Math.max(top, visible.top), maxTop),
  }
}
