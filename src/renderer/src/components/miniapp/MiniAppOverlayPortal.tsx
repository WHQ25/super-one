import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { icons } from 'lucide-react'
import type { TooltipState, ContextMenuState, PopoverState } from '@/hooks/useMiniAppOverlay'
import type { MiniAppContextMenuItem } from '../../../../shared/miniapp-types'
import { handleMiniAppMessage } from '@/hooks/miniapp-message-handler'

interface MiniAppOverlayPortalProps {
  tooltip: TooltipState | null
  contextMenu: ContextMenuState | null
  popover: PopoverState | null
  onDismissContextMenu: (itemId: string | null) => void
  onDismissPopover: () => void
}

function OverlayTooltip({ state }: { state: TooltipState }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { rect, side } = state
    const gap = 6
    let top = 0
    let left = 0

    if (side === 'top') {
      top = rect.top - el.offsetHeight - gap
      left = rect.left + rect.width / 2 - el.offsetWidth / 2
    } else if (side === 'bottom') {
      top = rect.bottom + gap
      left = rect.left + rect.width / 2 - el.offsetWidth / 2
    } else if (side === 'left') {
      top = rect.top + rect.height / 2 - el.offsetHeight / 2
      left = rect.left - el.offsetWidth - gap
    } else {
      top = rect.top + rect.height / 2 - el.offsetHeight / 2
      left = rect.right + gap
    }

    top = Math.max(4, Math.min(top, window.innerHeight - el.offsetHeight - 4))
    left = Math.max(4, Math.min(left, window.innerWidth - el.offsetWidth - 4))

    el.style.top = `${top}px`
    el.style.left = `${left}px`
  })

  const arrowPos = {
    top: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
    bottom: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
    left: 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2',
    right: 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2',
  }[state.side]

  return (
    <div
      ref={ref}
      className="fixed z-50 w-fit max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background text-balance animate-in fade-in-0 zoom-in-95"
      style={{ top: -9999, left: -9999 }}
    >
      {state.text}
      <div className={`absolute size-2 rotate-45 rounded-[1px] bg-foreground ${arrowPos}`} />
    </div>
  )
}

function LucideIcon({ name, className }: { name: string; className?: string }) {
  const pascalName = name
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') as keyof typeof icons
  const Icon = icons[pascalName]
  if (!Icon) return null
  return <Icon className={className} />
}

export interface MenuGroup {
  label?: string
  items: MiniAppContextMenuItem[]
}

export function groupItems(items: MiniAppContextMenuItem[]): MenuGroup[] {
  const groups: MenuGroup[] = []
  let current: MenuGroup = { items: [] }
  for (const item of items) {
    if (item.separator) {
      if (current.items.length > 0) groups.push(current)
      current = { items: [] }
    } else if (item.group && item.group !== current.label) {
      if (current.items.length > 0) groups.push(current)
      current = { label: item.group, items: [item] }
    } else {
      if (item.group) current.label = item.group
      current.items.push(item)
    }
  }
  if (current.items.length > 0) groups.push(current)
  return groups
}

function OverlayContextMenu({
  state,
  onDismiss,
}: {
  state: ContextMenuState
  onDismiss: (itemId: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupItems(state.items), [state.items])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let { x: left, y: top } = state.position
    top = Math.min(top, window.innerHeight - el.offsetHeight - 4)
    left = Math.min(left, window.innerWidth - el.offsetWidth - 4)
    el.style.top = `${Math.max(0, top)}px`
    el.style.left = `${Math.max(0, left)}px`
  })

  const handleBackdropClick = useCallback(() => onDismiss(null), [onDismiss])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onDismiss])

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={handleBackdropClick} />
      <div
        ref={ref}
        className="fixed z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        style={{ top: -9999, left: -9999 }}
      >
        {groups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="bg-border -mx-1 my-1 h-px" />}
            {group.label && (
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <button
                key={item.id}
                disabled={item.disabled}
                onClick={() => onDismiss(item.id)}
                className={`flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 ${
                  item.variant === 'destructive'
                    ? 'text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/20'
                    : ''
                }`}
              >
                {item.icon && (
                  <LucideIcon
                    name={item.icon}
                    className={`size-4 shrink-0 ${
                      item.variant === 'destructive' ? 'text-destructive' : 'text-muted-foreground'
                    }`}
                  />
                )}
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function OverlayPopover({
  state,
  onDismiss,
}: {
  state: PopoverState
  onDismiss: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)
  const readyRef = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { anchorRect, side, align, width: popWidth } = state
    const gap = 8
    const elW = popWidth ?? el.offsetWidth
    const elH = el.offsetHeight
    let top = 0
    let left = 0

    if (side === 'top') {
      top = anchorRect.top - elH - gap
    } else if (side === 'bottom') {
      top = anchorRect.bottom + gap
    } else if (side === 'left') {
      top = anchorRect.top
      left = anchorRect.left - elW - gap
    } else {
      top = anchorRect.top
      left = anchorRect.right + gap
    }

    if (side === 'top' || side === 'bottom') {
      if (align === 'start') left = anchorRect.left
      else if (align === 'end') left = anchorRect.right - elW
      else left = anchorRect.left + anchorRect.width / 2 - elW / 2
    }

    top = Math.max(4, Math.min(top, window.innerHeight - elH - 4))
    left = Math.max(4, Math.min(left, window.innerWidth - elW - 4))

    el.style.top = `${top}px`
    el.style.left = `${left}px`
  })

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onDismiss])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const sendToIframe = (msg: unknown) => {
      iframe.contentWindow?.postMessage(msg, '*')
    }
    state.iframeSendRef.current = sendToIframe

    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return
      const data = e.data
      if (!data || !data.type) return

      if (data.type === 'miniapp-ready') {
        readyRef.current = true
        state.sendToMain({ type: 'miniapp-popover-opened' })
        return
      }

      if (data.type === 'miniapp-resize') {
        const h = data.height as number
        if (h > 0) setHeight(state.maxHeight ? Math.min(h, state.maxHeight) : h)
        return
      }

      if (data.type === 'miniapp-popover-msg') {
        state.sendToMain({ type: 'miniapp-popover-msg', data: data.data })
        return
      }

      if (data.type === 'miniapp-popover-close') {
        onDismiss()
        return
      }

      handleMiniAppMessage(data.type, data, state.appId, sendToIframe)
    }

    window.addEventListener('message', handleMessage)
    return () => {
      state.iframeSendRef.current = null
      window.removeEventListener('message', handleMessage)
    }
  }, [state, onDismiss])

  const iframeHeight = state.maxHeight ? Math.min(height, state.maxHeight) : height

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onDismiss} />
      <div
        ref={containerRef}
        className="fixed z-50 overflow-hidden rounded-lg border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95"
        style={{ top: -9999, left: -9999, width: state.width }}
      >
        <iframe
          ref={iframeRef}
          src={state.templateUrl}
          sandbox="allow-scripts"
          className="block w-full border-0"
          style={{ height: iframeHeight }}
        />
      </div>
    </>
  )
}

export function MiniAppOverlayPortal({ tooltip, contextMenu, popover, onDismissContextMenu, onDismissPopover }: MiniAppOverlayPortalProps) {
  if (!tooltip && !contextMenu && !popover) return null

  return createPortal(
    <>
      {tooltip && <OverlayTooltip state={tooltip} />}
      {contextMenu && <OverlayContextMenu state={contextMenu} onDismiss={onDismissContextMenu} />}
      {popover && <OverlayPopover state={popover} onDismiss={onDismissPopover} />}
    </>,
    document.body,
  )
}
