import type { RefObject } from 'react'
import { SESSION_DRAG_MIME, useMosaicStore, dropWouldNoOp } from './mosaic-store'
import {
  collectLeaves,
  computeDropEdge,
  nodeAtPath,
  planDrop,
  DIVIDER_SIZE,
  MIN_TILE_W,
  MIN_TILE_H,
  type DropEdge,
  type DropPlan,
  type MosaicNode,
} from './mosaic-tree'
import { unionLeafRectRel } from './mosaic-dom'

/**
 * Re-evaluate whether the drop fits using *actual* on-screen sizes, not the
 * ratio-derived rects — once per-pane min sizes kick in on shrink, the real
 * layout diverges from the tree ratios.
 */
function domAllowed(plan: DropPlan, root: MosaicNode | null, container: HTMLElement | null, targetRect: DOMRect): boolean {
  const horizontal = plan.edge === 'left' || plan.edge === 'right'
  const minTile = horizontal ? MIN_TILE_W : MIN_TILE_H
  if (plan.mode === 'band' && plan.regionPath && plan.count && root && container) {
    const ids = collectLeaves(nodeAtPath(root, plan.regionPath)).map((l) => l.id)
    const region = unionLeafRectRel(container, ids)
    if (region) {
      const extent = plan.axis === 'x' ? region.w : region.h
      return extent >= plan.count * minTile + (plan.count - 1) * DIVIDER_SIZE
    }
  }
  const extent = horizontal ? targetRect.width : targetRect.height
  return extent >= 2 * minTile + DIVIDER_SIZE
}

interface MosaicDropZoneProps {
  tileId: string | null
  onDropSession: (folderPath: string, sessionId: string, edge: DropEdge) => void
  containerRef?: RefObject<HTMLElement | null>
}

export function MosaicDropZone({ tileId, onDropSession, containerRef }: MosaicDropZoneProps) {
  return (
    <div
      className="absolute inset-0 z-20"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SESSION_DRAG_MIME)) return
        e.preventDefault()
        const dragged = useMosaicStore.getState().draggedSession
        if (dragged && dropWouldNoOp(dragged.projectPath, dragged.sessionId)) {
          e.dataTransfer.dropEffect = 'none'
          useMosaicStore.getState().setDropHint(null)
          return
        }
        const rect = e.currentTarget.getBoundingClientRect()
        const edge = computeDropEdge(rect, e.clientX, e.clientY)
        const root = useMosaicStore.getState().root
        const container = containerRef?.current ?? null
        const plan = planDrop(root, tileId, edge, container?.getBoundingClientRect() ?? rect)
        const allowed = domAllowed(plan, root, container, rect)
        e.dataTransfer.dropEffect = allowed ? 'move' : 'none'
        useMosaicStore.getState().setDropHint({ ...plan, allowed })
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) useMosaicStore.getState().setDropHint(null) }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const raw = e.dataTransfer.getData(SESSION_DRAG_MIME)
        useMosaicStore.getState().setDropHint(null)
        if (!raw) return
        const rect = e.currentTarget.getBoundingClientRect()
        const edge = computeDropEdge(rect, e.clientX, e.clientY)
        const root = useMosaicStore.getState().root
        const container = containerRef?.current ?? null
        const plan = planDrop(root, tileId, edge, container?.getBoundingClientRect() ?? rect)
        if (!domAllowed(plan, root, container, rect)) return
        try {
          const { folderPath, sessionId } = JSON.parse(raw)
          if (folderPath && sessionId) onDropSession(folderPath, sessionId, edge)
        } catch { /* ignore malformed drag payload */ }
      }}
    />
  )
}
