import type { ReactNode } from 'react'

/** Shared, borderless presentation for a tool whose result is an embedded View. */
export function EmbeddedToolView({ title, icon, actions, children }: {
  title: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return <div className="group/embedded-tool my-2 w-full min-w-0">
    <div data-embedded-tool-header className="mb-1.5 flex h-5 items-center justify-end gap-1.5 px-1 text-xs text-muted-foreground/70 opacity-0 transition-opacity group-hover/embedded-tool:opacity-100 group-focus-within/embedded-tool:opacity-100">
      {icon}
      <span className="min-w-0 truncate">{title}</span>
      {actions}
    </div>
    {children}
  </div>
}
