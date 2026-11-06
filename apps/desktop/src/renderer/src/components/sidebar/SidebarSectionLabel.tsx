import type { ReactElement, ReactNode } from 'react'
import { CircleCheck, NotebookPen, Pin } from 'lucide-react'
import { SidebarHoverChevron } from './hover-disclosure'
import { sidebarSectionPanelId, type SidebarSectionId } from './sidebar-section-collapse'

/**
 * Heading for a sidebar group such as Pinned, Drafts, or a project's Settled list.
 * The section glyph sits in front of the title and becomes a chevron on hover.
 * Settled keeps that chevron, pointing down, for as long as the group is open.
 * A count badge appears only while the group is folded.
 */
export function SidebarSectionLabel({
  section,
  count,
  collapsed,
  onToggle,
  controlsId,
  countTone = 'badge',
  chevronWhenExpanded = false,
  children,
  icon,
}: {
  section: SidebarSectionId | 'environment'
  count: number
  collapsed: boolean
  onToggle: () => void
  /** Overrides the shared section id when several groups of one kind are mounted. */
  controlsId?: string
  /** Settled totals get plain muted text. Pinned and Drafts keep the filled badge. */
  countTone?: 'badge' | 'plain'
  /** While open, leave the down chevron in the icon slot instead of the section glyph. */
  chevronWhenExpanded?: boolean
  icon?: ReactElement<{ className?: string }>
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-sidebar-section={section}
      aria-expanded={!collapsed}
      aria-controls={controlsId ?? (section === 'environment' ? undefined : sidebarSectionPanelId(section))}
      onClick={onToggle}
      className="group flex w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-left hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
    >
      <SidebarHoverChevron
        expanded={!collapsed}
        forceChevron={chevronWhenExpanded && !collapsed}
        className="size-3"
        glyph={icon ?? (section === 'pinned'
          ? <Pin className="text-sidebar-foreground/45" />
          : section === 'drafts'
            ? <NotebookPen className="text-sidebar-foreground/45" />
            : <CircleCheck className="text-sidebar-foreground/45" />)}
      />
      <span className="min-w-0 truncate text-xs font-medium text-sidebar-foreground/70 group-hover:text-sidebar-foreground">
        {children}
      </span>
      {collapsed && count > 0 && (
        <>
          {' '}
          <span
            data-slot="section-count"
            className={countTone === 'plain'
              ? 'ml-auto shrink-0 text-[11px] tabular-nums text-sidebar-foreground/40'
              : 'ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/15 px-1 text-[10px] font-medium leading-none text-sidebar-foreground tabular-nums'}
          >
            {count}
          </span>
        </>
      )}
    </button>
  )
}
