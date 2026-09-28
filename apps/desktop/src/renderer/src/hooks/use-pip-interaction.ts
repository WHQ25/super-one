import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createDragCapture } from '@/lib/drag-capture'
import { clampPipLayout, type PipBounds, type PipDimensions, type PipLayout } from '@/lib/pip-layout'

export type PipResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

export const PIP_RESIZE_CORNERS: Array<{ corner: PipResizeCorner; className: string }> = [
  { corner: 'nw', className: '-left-1 -top-1 cursor-nwse-resize' },
  { corner: 'ne', className: '-right-1 -top-1 cursor-nesw-resize' },
  { corner: 'sw', className: '-bottom-1 -left-1 cursor-nesw-resize' },
  { corner: 'se', className: '-bottom-1 -right-1 cursor-nwse-resize' },
]

const CLICK_SLOP = 4

interface PipInteractionOptions {
  bounds: PipBounds | null
  layout: PipLayout | null
  setLayout: (next: PipLayout) => void
  aspect: number
  dims: PipDimensions
  /** On screen; an interaction in progress ends when the preview goes away. */
  active: boolean
  /** A press that never moved past the slop: the preview's primary action. */
  onClick: () => void
}

/** Drag-to-move, click, and corner resize for a floating, aspect-locked preview. */
export function usePipInteraction({ bounds, layout, setLayout, aspect, dims, active, onClick }: PipInteractionOptions) {
  const [interacting, setInteracting] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    if (!active) cleanupRef.current?.()
  }, [active])
  useLayoutEffect(() => () => cleanupRef.current?.(), [])

  const startInteraction = useCallback((
    cursor: string,
    onMove: (event: PointerEvent) => void,
    onEnd?: () => void,
  ) => {
    cleanupRef.current?.()
    setInteracting(true)
    const capture = createDragCapture(cursor)
    capture.acquire()
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      capture.release()
      cleanupRef.current = null
      setInteracting(false)
      onEnd?.()
    }
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || !layout || event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const start = layout
    let dragging = false
    startInteraction('grabbing', (move) => {
      const dx = move.clientX - startX
      const dy = move.clientY - startY
      if (!dragging && Math.abs(dx) <= CLICK_SLOP && Math.abs(dy) <= CLICK_SLOP) return
      dragging = true
      setLayout(clampPipLayout({ ...start, left: start.left + dx, top: start.top + dy }, bounds, dims, aspect))
    }, () => {
      if (!dragging) onClick()
    })
  }, [aspect, bounds, dims, layout, onClick, setLayout, startInteraction])

  const startResize = useCallback((corner: PipResizeCorner, event: React.PointerEvent<HTMLDivElement>) => {
    if (!bounds || !layout || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const start = layout
    const west = corner.includes('w')
    const north = corner.includes('n')
    const cursor = corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize'
    startInteraction(cursor, (move) => {
      const dx = move.clientX - startX
      const dy = move.clientY - startY
      const fromWidth = start.width + (west ? -dx : dx)
      const fromHeight = (start.height + (north ? -dy : dy)) * aspect
      const width = Math.abs(fromWidth - start.width) >= Math.abs(fromHeight - start.width)
        ? fromWidth
        : fromHeight
      const fitted = clampPipLayout({ left: start.left, top: start.top, width, height: width / aspect }, bounds, dims, aspect)
      setLayout(clampPipLayout({
        ...fitted,
        left: west ? start.left + start.width - fitted.width : start.left,
        top: north ? start.top + start.height - fitted.height : start.top,
      }, bounds, dims, aspect))
    })
  }, [aspect, bounds, dims, layout, setLayout, startInteraction])

  return { interacting, onPointerDown, startResize }
}
