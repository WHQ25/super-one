import type { ReactNode } from 'react'

/** Small heading over a global sidebar group such as Pinned or Drafts. */
export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return <span className="block px-1.5 py-1.5 text-xs font-medium text-sidebar-foreground/70">{children}</span>
}
