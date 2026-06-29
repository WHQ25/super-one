import { useRef } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { useMosaicStore } from './mosaic-store'
import { subtreeRect, DIVIDER_SIZE, type DropEdge, type Rect } from './mosaic-tree'

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
  const ref = useRef<HTMLDivElement>(null)
  const hint = useMosaicStore((s) => s.dropHint)
  const root = useMosaicStore((s) => s.root)

  let content = null
  const c = ref.current?.getBoundingClientRect()
  if (hint && c) {
    const full: Rect = { x: 0, y: 0, w: c.width, h: c.height }
    let box: Rect
    if (hint.mode === 'band' && hint.regionPath && hint.count && root) {
      const region = subtreeRect(root, hint.regionPath, full)
      const { index = 0, count, axis } = hint
      if (axis === 'x') {
        const slot = (region.w - (count - 1) * DIVIDER_SIZE) / count
        box = { x: region.x + index * (slot + DIVIDER_SIZE), y: region.y, w: slot, h: region.h }
      } else {
        const slot = (region.h - (count - 1) * DIVIDER_SIZE) / count
        box = { x: region.x, y: region.y + index * (slot + DIVIDER_SIZE), w: region.w, h: slot }
      }
    } else {
      const target = root && hint.targetPath ? subtreeRect(root, hint.targetPath, full) : full
      box = halfRect(hint.edge, target)
    }
    const color = hint.allowed ? 'border-primary bg-primary/20' : 'border-muted-foreground/40 bg-muted-foreground/15'
    content = (
      <div
        className={cn('absolute rounded-lg border-2 transition-all', color)}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      >
        {!hint.allowed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-muted-foreground shadow-sm">空间不足</span>
          </div>
        )}
      </div>
    )
  }

  return <div ref={ref} className="pointer-events-none absolute inset-0 z-30">{content}</div>
}
