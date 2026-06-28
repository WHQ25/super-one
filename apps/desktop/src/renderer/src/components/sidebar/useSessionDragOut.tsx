import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DragPreviewPill } from './SessionDragPreviewContent'

interface UseSessionDragOutParams {
  folderPath: string
  sessionId: string
  title: string
}

export function useSessionDragOut({ folderPath, sessionId, title }: UseSessionDragOutParams) {
  const rowRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  const outsideRef = useRef(false)
  const unsubZoneRef = useRef<(() => void) | null>(null)
  const [visible, setVisible] = useState(false)

  const positionPreview = useCallback((clientX: number, clientY: number) => {
    const node = previewRef.current
    if (!node) return
    const x = Math.min(Math.max(clientX - node.offsetWidth / 2, 4), window.innerWidth - node.offsetWidth - 4)
    const y = Math.min(Math.max(clientY + 8, 4), window.innerHeight - node.offsetHeight - 4)
    node.style.transform = `translate(${x}px, ${y}px)`
  }, [])

  useLayoutEffect(() => {
    if (visible && lastPosRef.current) positionPreview(lastPosRef.current.x, lastPosRef.current.y)
  }, [visible, positionPreview])

  const teardown = useCallback(() => {
    unsubZoneRef.current?.()
    unsubZoneRef.current = null
    lastPosRef.current = null
    outsideRef.current = false
    setVisible(false)
  }, [])

  const onDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = 'move'
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => ghost.remove(), 0)
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    outsideRef.current = false
    setVisible(true)
    unsubZoneRef.current = window.app.onDragPreviewZone((zone) => {
      outsideRef.current = zone === 'outside'
      setVisible(zone !== 'outside')
    })
    void window.app.startDragPreview(title)
  }, [title])

  const onDrag = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.clientX === 0 && e.clientY === 0) return
    if (outsideRef.current) return
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    positionPreview(e.clientX, e.clientY)
    setVisible(true)
  }, [positionPreview])

  const onDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const { screenX, screenY } = e
    const left = window.screenX
    const top = window.screenY
    const outside =
      screenX < left || screenX > left + window.outerWidth || screenY < top || screenY > top + window.outerHeight
    if (outside) {
      window.app.openSessionWindow(folderPath, sessionId, title, { x: screenX - 40, y: screenY - 12 })
    }
    void window.app.endDragPreview()
    teardown()
  }, [folderPath, sessionId, title, teardown])

  const dragHandlers = { draggable: true, onDragStart, onDrag, onDragEnd }

  const dragPreview = visible
    ? createPortal(
        <div ref={previewRef} className="pointer-events-none fixed left-0 top-0 z-[9999] will-change-transform">
          <DragPreviewPill title={title} />
        </div>,
        document.body,
      )
    : null

  return { rowRef, dragHandlers, dragPreview }
}
