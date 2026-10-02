import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'

const MORPH = 'duration-200 ease-out motion-reduce:transition-none'

/**
 * Shared, borderless presentation for a tool whose result is an embedded View.
 * A collapsible View folds into an ordinary tool row (title on the left, its
 * actions kept on the right) and unfolds back into the title above the View;
 * spacers whose `flex-grow` transitions carry the title across.
 */
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
  const collapsible = !!onToggleCollapsed
  const asRow = collapsible && !!collapsed
  const heading = <>{icon}<span className={cn('min-w-0 truncate transition-colors', MORPH, asRow && 'font-medium text-foreground')}>{title}</span></>
  // Each spacer cancels the gap it adds, so a collapsed title lines up with tool rows.
  const spacer = (grow: boolean, side: 'start' | 'end') => <span aria-hidden className={cn('min-w-0 basis-0 transition-[flex-grow]', MORPH, side === 'start' ? '-mr-1.5' : '-ml-1.5', grow ? 'grow' : 'grow-0')} />
  return <div className={cn('group/embedded-tool w-full min-w-0 transition-[margin]', MORPH, asRow ? 'my-0.5' : 'my-2')}>
    <div data-embedded-tool-header data-collapsed={asRow || undefined}
      // As a row, the whole surface toggles like any tool row; its buttons keep their own actions.
      onClick={asRow ? event => { if (!(event.target as Element).closest('button')) onToggleCollapsed!() } : undefined}
      // As a row it is a `tool-node`, so it takes the tool rows' timeline line and dark-theme surface too.
      className={cn('flex items-center gap-1.5 text-xs transition-[height,padding,margin,border,background-color,color]', MORPH,
        // Unfolded, the header has no surface; square, so the fading timeline line never curves.
        !collapsible && 'justify-end', asRow || !collapsible ? 'rounded' : 'rounded-none',
        asRow ? 'tool-node mb-0 h-7 cursor-pointer bg-muted/20 px-2 text-muted-foreground hover:bg-muted/40' : 'mb-1.5 h-5 px-1 text-muted-foreground/70',
        !pinnedHeader && 'opacity-0 transition-opacity group-hover/embedded-tool:opacity-100 group-focus-within/embedded-tool:opacity-100')}>
      {collapsible && spacer(!asRow, 'start')}
      {onToggleCollapsed
        ? <button type="button" data-embedded-tool-title aria-expanded={!collapsed} onClick={onToggleCollapsed}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{heading}</button>
        : heading}
      {collapsible && spacer(asRow, 'end')}
      {actions}
      {/* A 12px chevron pulled into the button's slack, centred where tool rows put theirs. */}
      {onToggleCollapsed && <IconButton data-embedded-tool-toggle size="xs" variant="ghost" aria-expanded={!collapsed} className="-mr-1"
        tooltip={t(collapsed ? 'tooltips.expandView' : 'tooltips.collapseView')} onClick={onToggleCollapsed}>
        <ChevronDown className={cn('size-3 transition-transform', MORPH, collapsed && '-rotate-90')} />
      </IconButton>}
    </div>
    {children}
  </div>
}
