import { cloneElement, isValidElement, type ReactElement, type ReactNode, type MouseEvent } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@superone/ui/components/ui/context-menu'
import { useAppStore } from '@/stores/app'
import { showNativeContextMenu, toNativeMenu, type AdaptiveMenuEntry } from '@/lib/native-context-menu'

interface AdaptiveContextMenuProps {
  items: AdaptiveMenuEntry[]
  children: ReactNode
  contentClassName?: string
  /** Checked at right-click time: when true, this menu stays closed and the event bubbles on to an ancestor's menu. */
  yieldWhen?: () => boolean
}

function ContextMenuEntries({ items }: { items: AdaptiveMenuEntry[] }) {
  return items.map((entry, i) => {
    if (entry.kind === 'separator') return <ContextMenuSeparator key={i} />
    if (entry.kind === 'submenu') {
      return (
        <ContextMenuSub key={entry.id}>
          <ContextMenuSubTrigger className="text-xs">
            {entry.icon ? <entry.icon className="size-3.5" /> : null}
            {entry.label}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuEntries items={entry.items} />
          </ContextMenuSubContent>
        </ContextMenuSub>
      )
    }
    return (
      <ContextMenuItem
        key={entry.id}
        variant={entry.destructive ? 'destructive' : 'default'}
        disabled={entry.disabled}
        onClick={entry.onSelect}
        className="text-xs"
      >
        {entry.icon ? <entry.icon className="size-3.5" /> : null}
        {entry.label}
      </ContextMenuItem>
    )
  })
}

export function AdaptiveContextMenu({ items, children, contentClassName, yieldWhen }: AdaptiveContextMenuProps) {
  const liquidGlass = useAppStore((s) => s.liquidGlass)

  if (liquidGlass) {
    const open = (e: MouseEvent) => {
      if (yieldWhen?.()) return
      e.preventDefault()
      void showNativeContextMenu(toNativeMenu(items))
    }
    if (isValidElement(children)) {
      const child = children as ReactElement<{ onContextMenu?: (e: MouseEvent) => void }>
      return cloneElement(child, {
        onContextMenu: (e: MouseEvent) => {
          child.props.onContextMenu?.(e)
          open(e)
        },
      })
    }
    return (
      <span style={{ display: 'contents' }} onContextMenu={open}>
        {children}
      </span>
    )
  }

  return (
    <ContextMenu>
      {/* Radix skips opening when the event arrives already default-prevented. */}
      <ContextMenuTrigger asChild onContextMenu={yieldWhen ? (e) => { if (yieldWhen()) e.preventDefault() } : undefined}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className={contentClassName}>
        <ContextMenuEntries items={items} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
