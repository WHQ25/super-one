import type { ReactNode } from 'react'
import { CircleCheck, NotebookPen, Pin } from 'lucide-react'
import { SidebarHoverChevron } from './hover-disclosure'
import { sidebarSectionPanelId, type SidebarSectionId } from './sidebar-section-collapse'

/**
 * Heading for a sidebar group such as Pinned, Drafts, or a project's Settled list.
 * The section glyph sits in front of the title and becomes a chevron on hover.
 * A count badge appears only while the group is folded.
 */
export function SidebarSectionLabel({
  section,
  count,
  collapsed,
  onToggle,
  controlsId,
  countTone = 'badge',
  divider = false,
  children,
}: {
  section: SidebarSectionId
  count: number
  collapsed: boolean
  onToggle: () => void
  /** Overrides the shared section id when several groups of one kind are mounted. */
  controlsId?: string
  /** Settled totals get plain muted text. Pinned and Drafts keep the filled badge. */
  countTone?: 'badge' | 'plain'
  /**
   * A hairline on the bottom edge of this heading, in the hover color.
   * The hover fill is the same color, so the line disappears into it at once
   * and is visible again as soon as the pointer leaves.
   */
  divider?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-sidebar-section={section}
      aria-expanded={!collapsed}
      aria-controls={controlsId ?? sidebarSectionPanelId(section)}
      onClick={onToggle}
      className={`group flex w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-left hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring${divider ? ' relative overflow-hidden' : ''}`}
    >
      <SidebarHoverChevron
        expanded={!collapsed}
        className="size-3"
        glyph={section === 'pinned'
          ? <Pin className="text-sidebar-foreground/45" />
          : section === 'drafts'
            ? <NotebookPen className="text-sidebar-foreground/45" />
            : <CircleCheck className="text-sidebar-foreground/45" />}
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
      {divider ? (
        <span
          data-slot="settled-divider"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-sidebar-hover"
        />
      ) : null}
    </button>
  )
}
