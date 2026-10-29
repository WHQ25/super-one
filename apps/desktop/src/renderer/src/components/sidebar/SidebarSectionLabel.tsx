import type { ReactNode } from 'react'
import { NotebookPen, Pin } from 'lucide-react'
import { SidebarHoverChevron } from './hover-disclosure'
import { sidebarSectionPanelId, type SidebarSectionId } from './sidebar-section-collapse'

/**
 * Heading for a global sidebar group such as Pinned or Drafts.
 * The section glyph sits in front of the title and becomes a chevron on hover.
 * A count badge appears only while the group is folded.
 */
export function SidebarSectionLabel({
  section,
  count,
  collapsed,
  onToggle,
  children,
}: {
  section: SidebarSectionId
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-sidebar-section={section}
      aria-expanded={!collapsed}
      aria-controls={sidebarSectionPanelId(section)}
      onClick={onToggle}
      className="group flex w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-left hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
    >
      <SidebarHoverChevron
        expanded={!collapsed}
        className="size-3"
        glyph={section === 'pinned'
          ? <Pin className="text-sidebar-foreground/45" />
          : <NotebookPen className="text-sidebar-foreground/45" />}
      />
      <span className="min-w-0 truncate text-xs font-medium text-sidebar-foreground/70 group-hover:text-sidebar-foreground">
        {children}
      </span>
      {collapsed && count > 0 && (
        <>
          {' '}
          <span
            data-slot="section-count"
            className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/15 px-1 text-[10px] font-medium leading-none text-sidebar-foreground tabular-nums"
          >
            {count}
          </span>
        </>
      )}
    </button>
  )
}
