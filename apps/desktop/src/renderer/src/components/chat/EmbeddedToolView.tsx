import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'

/** Shared, borderless presentation for a tool whose result is an embedded View. */
export function EmbeddedToolView({ title, icon, actions, pinnedHeader = false, collapsed, onToggleCollapsed, children }: {
  title: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  /** Keep the header visible instead of revealing it on hover or focus. */
  pinnedHeader?: boolean
  /** With `onToggleCollapsed`, the title and a trailing chevron both toggle the body. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const heading = <>{icon}<span className="min-w-0 truncate">{title}</span></>
  return <div className="group/embedded-tool my-2 w-full min-w-0">
    <div data-embedded-tool-header className={cn('mb-1.5 flex h-5 items-center justify-end gap-1.5 px-1 text-xs text-muted-foreground/70',
      !pinnedHeader && 'opacity-0 transition-opacity group-hover/embedded-tool:opacity-100 group-focus-within/embedded-tool:opacity-100')}>
      {onToggleCollapsed
        ? <button type="button" data-embedded-tool-title aria-expanded={!collapsed} onClick={onToggleCollapsed}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{heading}</button>
        : heading}
      {actions}
      {onToggleCollapsed && <IconButton data-embedded-tool-toggle size="xs" variant="ghost" aria-expanded={!collapsed}
        tooltip={t(collapsed ? 'tooltips.expandView' : 'tooltips.collapseView')} onClick={onToggleCollapsed}>
        <ChevronDown className={cn('size-3.5 transition-transform duration-200 motion-reduce:transition-none', collapsed && '-rotate-90')} />
      </IconButton>}
    </div>
    {children}
  </div>
}
