"use client"

import { cn } from "@superone/ui/lib/utils"

export type CategoryOption = {
  value: string
  label: string
  count: number
}

export function CategoryRail({
  options,
  value,
  onChange,
  heading,
}: {
  options: CategoryOption[]
  value: string
  onChange: (next: string) => void
  heading: string
}) {
  return (
    <aside className="md:sticky md:top-24 md:self-start">
      <div className="text-muted-foreground/80 mb-3 px-3 text-[11px] font-semibold uppercase tracking-wider">
        {heading}
      </div>
      <nav className="-mx-2 flex flex-row gap-1 overflow-x-auto px-2 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "group flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
              )}
            >
              <span className="font-medium">{opt.label}</span>
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  active ? "text-accent-foreground/70" : "text-muted-foreground/60",
                )}
              >
                {opt.count}
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
