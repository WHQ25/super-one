import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { useMosaicStore } from './mosaic-store'
import { collectLeaves, nodeAtPath, subtreeRect, DIVIDER_SIZE, MIN_TILE_W, MIN_TILE_H, type DropEdge, type Rect } from './mosaic-tree'
import { leafRectRel, unionLeafRectRel } from './mosaic-dom'

function halfRect(edge: DropEdge, r: Rect): Rect {
  switch (edge) {
    case 'left':
      return { x: r.x, y: r.y, w: r.w / 2, h: r.h }
    case 'right':
      return { x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h }
    case 'top':
      return { x: r.x, y: r.y, w: r.w, h: r.h / 2 }
    case 'bottom':
      return { x: r.x, y: r.y + r.h / 2, w: r.w, h: r.h / 2 }
  }
}

export function MosaicDropPreview() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const hint = useMosaicStore((s) => s.dropHint)
  const root = useMosaicStore((s) => s.root)

  let content = null
  const el = ref.current
  // Tiles live in the sibling SessionMosaic, not inside this overlay; query the
  // shared parent (the preview is inset-0 of it, so their origins coincide).
  const host = el?.parentElement ?? null
  if (hint && el) {
    const c = el.getBoundingClientRect()
    const full: Rect = { x: 0, y: 0, w: c.width, h: c.height }
    const target = (host && hint.targetTileId ? leafRectRel(host, hint.targetTileId) : null) ?? full
    let box: Rect
    if (hint.mode === 'band' && hint.regionPath && hint.count && root) {
      // Region from the actual DOM rects of the spine's tiles, so the band
      // tracks the real (possibly min-clamped) column/row sizes.
      const ids = collectLeaves(nodeAtPath(root, hint.regionPath)).map((l) => l.id)
      const region = (host && unionLeafRectRel(host, ids)) || subtreeRect(root, hint.regionPath, full)
      const { index = 0, count, axis } = hint
      if (axis === 'x') {
        const slot = (region.w - (count - 1) * DIVIDER_SIZE) / count
        box = { x: region.x + index * (slot + DIVIDER_SIZE), y: region.y, w: slot, h: region.h }
      } else {
        const slot = (region.h - (count - 1) * DIVIDER_SIZE) / count
        box = { x: region.x, y: region.y + index * (slot + DIVIDER_SIZE), w: region.w, h: slot }
      }
    } else {
      box = halfRect(hint.edge, target)
    }
    // Blocked: a min-sized block straddling the insertion seam (the target's
    // edge on the drop side), so the "no space" hint sits between the two tracks the new
    // one would split — not in the middle of the whole container.
    if (!hint.allowed) {
      const horizontal = hint.edge === 'left' || hint.edge === 'right'
      if (hint.mode === 'band') {
        if (horizontal) {
          const seam = hint.edge === 'left' ? target.x : target.x + target.w
          box = { x: seam - MIN_TILE_W / 2, y: target.y, w: MIN_TILE_W, h: target.h }
        } else {
          const seam = hint.edge === 'top' ? target.y : target.y + target.h
          box = { x: target.x, y: seam - MIN_TILE_H / 2, w: target.w, h: MIN_TILE_H }
        }
      } else if (horizontal) {
        box = { x: target.x + (target.w - MIN_TILE_W) / 2, y: target.y, w: MIN_TILE_W, h: target.h }
      } else {
        box = { x: target.x, y: target.y + (target.h - MIN_TILE_H) / 2, w: target.w, h: MIN_TILE_H }
      }
      box.x = Math.max(0, Math.min(box.x, c.width - box.w))
      box.y = Math.max(0, Math.min(box.y, c.height - box.h))
    }
    const color = hint.allowed ? 'border-primary bg-primary/20' : 'border-muted-foreground/40 bg-muted-foreground/15'
    content = (
      <div
        className={cn('absolute rounded-lg border-2 transition-all', color)}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      >
        {!hint.allowed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-muted-foreground shadow-sm">{t('shell.mosaic.noSpace')}</span>
          </div>
        )}
      </div>
    )
  }

  return <div ref={ref} className="pointer-events-none absolute inset-0 z-30">{content}</div>
}
