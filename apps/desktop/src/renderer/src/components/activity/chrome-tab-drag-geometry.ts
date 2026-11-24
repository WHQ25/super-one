import type { DropPosition } from '@/stores/activity-drop'

export const TOP_CORNER_RADIUS_PX = 14
export const FILLET_RADIUS_PX = 14
const SWAP_LEFT_RATIO = 0.45
const SWAP_RIGHT_RATIO = 0.55
const CONTENT_EDGE_RATIO = 0.35
const TABBAR_EDGE_GUARD_PX = 24

function fmt(value: number): number {
  return Number(value.toFixed(2))
}

function filletY(height: number, radius: number, dx: number): number {
  const clamped = Math.min(radius, Math.max(0, dx))
  return height - radius + Math.sqrt(Math.max(0, radius * radius - clamped * clamped))
}

export function buildHeaderRecessClipPath(
  width: number,
  height: number,
  tabLeft: number,
  tabRight: number,
  topRadius = TOP_CORNER_RADIUS_PX,
  filletRadius = FILLET_RADIUS_PX,
): string {
  if (width <= 0 || height <= 0) return ''
  const left = Math.max(0, Math.min(width, tabLeft))
  const right = Math.max(left, Math.min(width, tabRight))
  const tabWidth = right - left
  if (tabWidth <= 0) return ''

  const rt = Math.min(Math.max(0, topRadius), tabWidth / 2, height / 2)
  const rb = Math.min(Math.max(0, filletRadius), height - rt)
  const w = fmt(width)
  const h = fmt(height)
  const subpaths: string[] = []

  if (left > 0 || rt > 0) {
    const parts = [`M 0 0`, `L ${fmt(left + rt)} 0`]
    if (rt > 0.01) {
      parts.push(`A ${fmt(rt)} ${fmt(rt)} 0 0 0 ${fmt(left)} ${fmt(rt)}`)
    }
    if (left > 0) {
      parts.push(`L ${fmt(left)} ${fmt(height - rb)}`)
      const arcStartX = Math.max(0, left - rb)
      const yStart = arcStartX > 0 ? height : filletY(height, rb, rb - left)
      if (left - arcStartX > 0.01 && rb > 0.01) {
        parts.push(`A ${fmt(rb)} ${fmt(rb)} 0 0 1 ${fmt(arcStartX)} ${fmt(yStart)}`)
      }
      if (arcStartX > 0) parts.push(`L 0 ${h}`)
    }
    parts.push('Z')
    subpaths.push(parts.join(' '))
  }

  if (right < width || rt > 0) {
    const parts = [`M ${fmt(right - rt)} 0`, `L ${w} 0`]
    if (right < width) {
      const arcEndX = Math.min(width, right + rb)
      const yEnd = arcEndX < width ? height : filletY(height, rb, right + rb - width)
      if (arcEndX < width) {
        parts.push(`L ${w} ${h}`, `L ${fmt(arcEndX)} ${h}`)
      } else {
        parts.push(`L ${w} ${fmt(yEnd)}`)
      }
      if (arcEndX - right > 0.01 && rb > 0.01) {
        parts.push(`A ${fmt(rb)} ${fmt(rb)} 0 0 1 ${fmt(right)} ${fmt(height - rb)}`)
      }
    }
    parts.push(`L ${fmt(right)} ${fmt(rt)}`)
    if (rt > 0.01) {
      parts.push(`A ${fmt(rt)} ${fmt(rt)} 0 0 0 ${fmt(right - rt)} 0`)
    }
    parts.push('Z')
    subpaths.push(parts.join(' '))
  }

  return subpaths.length > 0 ? `path('${subpaths.join(' ')}')` : ''
}

export function buildSiblingClipPath(width: number, height: number, cutLeft: number, cutRight: number): string {
  if (width <= 0 || height <= 0 || cutRight <= 0 || cutLeft >= width) return ''
  if (cutLeft <= 0 && cutRight >= width) return 'inset(0 100% 0 0)'
  const w = fmt(width)
  const h = fmt(height)
  const subpaths: string[] = []
  if (cutLeft > 0) {
    const xEnd = fmt(Math.min(width, cutLeft))
    subpaths.push(`M 0 0 L ${xEnd} 0 L ${xEnd} ${h} L 0 ${h} Z`)
  }
  if (cutRight < width) {
    const xStart = fmt(Math.max(0, cutRight))
    subpaths.push(`M ${xStart} 0 L ${w} 0 L ${w} ${h} L ${xStart} ${h} Z`)
  }
  return subpaths.length > 0 ? `path('${subpaths.join(' ')}')` : ''
}

export function stepTabOrder(
  order: number[],
  sourceIndex: number,
  flowOrigin: number,
  widths: number[],
  dragLeft: number,
): boolean {
  let dir = 0
  const dragWidth = widths[sourceIndex]
  const dragRight = dragLeft + dragWidth
  while (true) {
    const currentSlot = order.indexOf(sourceIndex)
    let currentLeft = flowOrigin
    for (let slot = 0; slot < currentSlot; slot++) {
      currentLeft += widths[order[slot]]
    }

    if (dir <= 0 && currentSlot > 0) {
      const prevIdx = order[currentSlot - 1]
      const prevWidth = widths[prevIdx]
      const prevLeft = currentLeft - prevWidth
      if (dragLeft < prevLeft + prevWidth * SWAP_LEFT_RATIO) {
        order[currentSlot] = prevIdx
        order[currentSlot - 1] = sourceIndex
        dir = -1
        continue
      }
    }

    if (dir >= 0 && currentSlot < order.length - 1) {
      const nextIdx = order[currentSlot + 1]
      const nextWidth = widths[nextIdx]
      const nextLeft = currentLeft + dragWidth
      if (dragRight > nextLeft + nextWidth * SWAP_RIGHT_RATIO) {
        order[currentSlot] = nextIdx
        order[currentSlot + 1] = sourceIndex
        dir = 1
        continue
      }
    }

    break
  }
  return dir !== 0
}

export function findInsertIndexInStrip(tabRects: Array<{ left: number; right: number }>, centerX: number): number {
  for (let i = 0; i < tabRects.length; i++) {
    if (centerX < (tabRects[i].left + tabRects[i].right) / 2) return i
  }
  return tabRects.length
}

export function resolveFallbackSplitPosition(
  originRect: { left: number; right: number; top: number; bottom: number },
  siblingRect: { left: number; right: number; top: number; bottom: number },
): DropPosition {
  if (originRect.right <= siblingRect.left + 8) return 'left'
  if (originRect.left >= siblingRect.right - 8) return 'right'
  if (originRect.bottom <= siblingRect.top + 8) return 'top'
  if (originRect.top >= siblingRect.bottom - 8) return 'bottom'
  return 'center'
}

export function resolveContentPosition(rect: DOMRect, clientX: number, clientY: number): DropPosition | null {
  const x = clientX - rect.left
  const y = clientY - rect.top
  if (rect.width <= 0 || rect.height <= 0) return null
  if (x < rect.width * CONTENT_EDGE_RATIO) return 'left'
  if (x > rect.width * (1 - CONTENT_EDGE_RATIO)) return 'right'
  if (y < rect.height * CONTENT_EDGE_RATIO) {
    return y < TABBAR_EDGE_GUARD_PX ? null : 'top'
  }
  if (y > rect.height * (1 - CONTENT_EDGE_RATIO)) {
    return rect.height - y < TABBAR_EDGE_GUARD_PX ? null : 'bottom'
  }
  return 'center'
}

export function indicatorBox(rect: DOMRect, position: DropPosition) {
  const halfW = rect.width / 2
  const halfH = rect.height / 2
  switch (position) {
    case 'left': return { left: rect.left, top: rect.top, width: halfW, height: rect.height, position }
    case 'right': return { left: rect.left + halfW, top: rect.top, width: halfW, height: rect.height, position }
    case 'top': return { left: rect.left, top: rect.top, width: rect.width, height: halfH, position }
    case 'bottom': return { left: rect.left, top: rect.top + halfH, width: rect.width, height: halfH, position }
    case 'center': return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, position }
  }
}
