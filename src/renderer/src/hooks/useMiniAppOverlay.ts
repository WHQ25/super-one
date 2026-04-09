import { useState, useCallback, useMemo, useRef, type RefObject } from 'react'
import type { MiniAppOverlayCallbacks } from './miniapp-message-handler'
import type { MiniAppTooltipRequest, MiniAppContextMenuRequest } from '../../../shared/miniapp-types'

export interface TooltipState {
  rect: DOMRect
  text: string
  side: 'top' | 'bottom' | 'left' | 'right'
}

export interface ContextMenuState {
  position: { x: number; y: number }
  items: MiniAppContextMenuRequest['items']
  respond: (itemId: string | null) => void
}

export function useMiniAppOverlay(containerRef: RefObject<HTMLElement | null>) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const respondRef = useRef<((itemId: string | null) => void) | null>(null)

  const toAbsolute = useCallback((relX: number, relY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: rect.left + relX, y: rect.top + relY }
  }, [containerRef])

  const onTooltip = useCallback((req: MiniAppTooltipRequest | null) => {
    if (!req) {
      setTooltip(null)
      return
    }
    const pos = toAbsolute(req.anchorRect.x, req.anchorRect.y)
    setTooltip({
      rect: new DOMRect(pos.x, pos.y, req.anchorRect.width, req.anchorRect.height),
      text: req.text,
      side: req.side ?? 'top',
    })
  }, [toAbsolute])

  const onContextMenu = useCallback((req: MiniAppContextMenuRequest, respond: (itemId: string | null) => void) => {
    respondRef.current?.(null)
    respondRef.current = respond
    const pos = toAbsolute(req.position.x, req.position.y)
    setContextMenu({ position: pos, items: req.items, respond })
  }, [toAbsolute])

  const dismissContextMenu = useCallback((itemId: string | null) => {
    respondRef.current?.(itemId)
    respondRef.current = null
    setContextMenu(null)
  }, [])

  const overlayCallbacks = useMemo<MiniAppOverlayCallbacks>(
    () => ({ onTooltip, onContextMenu }),
    [onTooltip, onContextMenu],
  )

  return { tooltip, contextMenu, dismissContextMenu, overlayCallbacks }
}
