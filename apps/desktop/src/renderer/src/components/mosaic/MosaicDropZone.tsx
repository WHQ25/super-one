import type { RefObject } from 'react'
import { SESSION_DRAG_MIME, useMosaicStore } from './mosaic-store'
import { computeDropEdge, planDrop, type DropEdge } from './mosaic-tree'

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
        const rect = e.currentTarget.getBoundingClientRect()
        const edge = computeDropEdge(rect, e.clientX, e.clientY)
        const container = containerRef?.current?.getBoundingClientRect() ?? rect
        const plan = planDrop(useMosaicStore.getState().root, tileId, edge, container)
        e.dataTransfer.dropEffect = plan.allowed ? 'move' : 'none'
        useMosaicStore.getState().setDropHint(plan)
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
        const container = containerRef?.current?.getBoundingClientRect() ?? rect
        if (!planDrop(useMosaicStore.getState().root, tileId, edge, container).allowed) return
        try {
          const { folderPath, sessionId } = JSON.parse(raw)
          if (folderPath && sessionId) onDropSession(folderPath, sessionId, edge)
        } catch { /* ignore malformed drag payload */ }
      }}
    />
  )
}
