export type AnchorRect = { x: number; y: number; width: number; height: number }

export function popoverLayout(anchor: AnchorRect, viewport: {
  width: number; height: number; top: number; bottom: number
}, desiredWidth: number, contentHeight: number) {
  const margin = 8
  const top = viewport.top + margin
  const bottom = Math.max(top, viewport.height - viewport.bottom - margin)
  const above = Math.max(0, Math.min(bottom, anchor.y - margin) - top)
  const belowTop = Math.max(top, anchor.y + anchor.height + margin)
  const below = Math.max(0, bottom - belowTop)
  const side = above >= Math.min(contentHeight, 220) || above >= below ? 'above' : 'below'
  const available = side === 'above' ? above : below
  // With no useful anchored area (large text / split-view keyboard), use the
  // available viewport; contents remain scrollable instead of being clipped.
  const fallback = available < Math.min(contentHeight, 100)
  const height = Math.min(contentHeight, fallback ? bottom - top : available)
  const width = Math.max(0, Math.min(desiredWidth, viewport.width - margin * 2))
  return {
    left: Math.max(margin, Math.min(anchor.x, viewport.width - width - margin)),
    top: fallback ? top : side === 'above' ? Math.min(bottom, anchor.y - margin) - height : belowTop,
    width, height,
  }
}
