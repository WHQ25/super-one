import type { ReactNode } from 'react'

/**
 * Detail header shared by every provider view (builtin, custom, official, add-custom): identity on
 * the left, plan switcher / page actions on the right, description under.
 */
export function ProviderDetailHeader({ leading, actions, description }: {
  leading: ReactNode
  actions?: ReactNode
  description?: ReactNode
}) {
  return (
    <div>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">{leading}</div>
        {actions && <div className="flex min-w-0 max-w-full items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

/** Provider name in the detail header, sized like a settings page title. */
export function ProviderDetailTitle({ children }: { children: ReactNode }) {
  return <h2 className="min-w-0 truncate text-xl font-semibold">{children}</h2>
}
