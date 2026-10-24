import { cloneElement, type ReactElement } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/**
 * Hover actions on a `group` row, pinned to the row's right edge. Like a
 * session row's pin, they take no width at rest and appear on hover.
 */
export const sidebarRowActionsClass =
  'invisible ml-auto flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 group-hover:pointer-events-auto group-hover:visible group-hover:w-auto group-hover:opacity-100'

/**
 * One slot on a `group` row: the glyph shows at rest, and the chevron replaces
 * it on hover. Both paint in the same box (`className`, default `size-4`) so
 * the label does not shift. `locked` keeps the glyph (a missing folder or a
 * loading spinner). The default `size-4` is the sidebar icon slot: with the
 * rows' `px-2.5` and `gap-2`, every label starts at the same x.
 */
export function SidebarHoverChevron({
  expanded,
  locked = false,
  className,
  glyph,
}: {
  expanded: boolean
  locked?: boolean
  /** Box size. Match the glyph, otherwise the swap still shifts the label. */
  className?: string
  glyph: ReactElement<{ className?: string }>
}) {
  const icon = cloneElement(glyph, {
    className: cn(
      glyph.props.className,
      'col-start-1 row-start-1 size-full',
      !locked && 'group-hover:hidden',
    ),
  })
  return (
    <span className={cn('grid shrink-0', className ?? 'size-4')}>
      <ChevronRight
        className={cn(
          'col-start-1 row-start-1 hidden size-full text-sidebar-foreground/70 transition-transform duration-200 group-hover:block',
          expanded && 'rotate-90',
          locked && '!hidden',
        )}
      />
      {icon}
    </span>
  )
}
