import { useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { icons } from 'lucide-react'
import type { TooltipState, ContextMenuState } from '@/hooks/useMiniAppOverlay'
import type { MiniAppContextMenuItem } from '../../../../shared/miniapp-types'

interface MiniAppOverlayPortalProps {
  tooltip: TooltipState | null
  contextMenu: ContextMenuState | null
  onDismissContextMenu: (itemId: string | null) => void
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

export function MiniAppOverlayPortal({ tooltip, contextMenu, onDismissContextMenu }: MiniAppOverlayPortalProps) {
  if (!tooltip && !contextMenu) return null

  return createPortal(
    <>
      {tooltip && <OverlayTooltip state={tooltip} />}
      {contextMenu && <OverlayContextMenu state={contextMenu} onDismiss={onDismissContextMenu} />}
    </>,
    document.body,
  )
}
