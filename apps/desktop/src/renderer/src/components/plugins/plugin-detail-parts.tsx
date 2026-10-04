import type { ReactNode } from 'react'

export function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

export function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  )
}
