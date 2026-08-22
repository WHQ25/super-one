import { useState, useCallback, useMemo, useRef, type RefObject, type MutableRefObject } from 'react'
import type { MiniAppOverlayCallbacks } from './miniapp-message-handler'
import type { MiniAppTooltipRequest, MiniAppContextMenuRequest, MiniAppPopoverShowRequest } from '@superone/shared/miniapp-types'
import { buildMiniAppUrlHost } from '@superone/shared/miniapp-url'
import { useAppStore } from '@/stores/app'

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

export interface PopoverState {
  appId: string
  projectDir: string
  template: string
  templateUrl: string
  anchorRect: DOMRect
  side: 'top' | 'bottom' | 'left' | 'right'
  align: 'start' | 'center' | 'end'
  width?: number
  maxHeight?: number
  sendToMain: (msg: unknown) => void
  webviewSendRef: MutableRefObject<((msg: unknown) => void) | null>
}

export function useMiniAppOverlay(
  containerRef: RefObject<HTMLElement | null>,
  appId?: string,
  projectDir?: string,
  templates?: Record<string, string>,
) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const respondRef = useRef<((itemId: string | null) => void) | null>(null)
  const sendClosedRef = useRef<((msg: unknown) => void) | null>(null)
  const popoverWebviewSendRef = useRef<((msg: unknown) => void) | null>(null)

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

  const closePopover = useCallback(() => {
    sendClosedRef.current?.({ type: 'miniapp-popover-closed' })
    sendClosedRef.current = null
    popoverWebviewSendRef.current = null
    setPopover(null)
  }, [])

  const onPopoverShow = useCallback((req: MiniAppPopoverShowRequest, send: (data: unknown) => void) => {
    if (!appId || !projectDir || !templates) return
    const templatePath = templates[req.template]
    if (!templatePath) return

    if (sendClosedRef.current) {
      sendClosedRef.current({ type: 'miniapp-popover-closed' })
    }
    sendClosedRef.current = send
    popoverWebviewSendRef.current = null

    const pos = toAbsolute(req.anchorRect.x, req.anchorRect.y)
    const dataParam = req.data != null ? `&_popoverData=${encodeURIComponent(JSON.stringify(req.data))}` : ''
    const projectId = useAppStore.getState().currentProjectId
    const templateUrl = `superone-app://${buildMiniAppUrlHost(appId, projectId)}/${templatePath}?_popover=${req.template}${dataParam}`

    setPopover({
      appId,
      projectDir,
      template: req.template,
      templateUrl,
      anchorRect: new DOMRect(pos.x, pos.y, req.anchorRect.width, req.anchorRect.height),
      side: req.side ?? 'bottom',
      align: req.align ?? 'center',
      width: req.width,
      maxHeight: req.maxHeight,
      sendToMain: (msg) => send(msg),
      webviewSendRef: popoverWebviewSendRef,
    })
  }, [appId, projectDir, templates, toAbsolute])

  const onPopoverMsg = useCallback((data: unknown) => {
    popoverWebviewSendRef.current?.({ type: 'miniapp-popover-msg', data })
  }, [])

  const onPopoverClose = useCallback(() => {
    closePopover()
  }, [closePopover])

  const overlayCallbacks = useMemo<MiniAppOverlayCallbacks>(
    () => ({ onTooltip, onContextMenu, onPopoverShow, onPopoverMsg, onPopoverClose }),
    [onTooltip, onContextMenu, onPopoverShow, onPopoverMsg, onPopoverClose],
  )

  return { tooltip, contextMenu, dismissContextMenu, popover, closePopover, overlayCallbacks }
}
