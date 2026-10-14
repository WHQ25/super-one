import type { ReactNode } from 'react'
import { Badge } from '@superone/ui/components/ui/badge'
import { SettingsCard } from './settings/SettingsSection'

/** One subscription account; render inside a `<ul className="flex flex-col gap-2">` so each account stands as its own card. */
export function ProviderAccountCard({ children }: { children: ReactNode }) {
  return <li><SettingsCard className="flex min-w-0 flex-col gap-3 px-3 py-2.5">{children}</SettingsCard></li>
}

export function ProviderAccountHeader({ email, detail, plan, isDefault, defaultLabel, state }: {
  email: string; detail?: string | null; plan?: string | null; isDefault?: boolean; defaultLabel: string; state?: string | null
}) {
  return <div className="flex items-start justify-between gap-3">
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-sm break-all" title={email}>{email}</span>
        {isDefault && <Badge variant="secondary">{defaultLabel}</Badge>}
      </div>
      {detail && <span className="text-xs text-muted-foreground break-all">{detail}</span>}
      {state && <span className="text-xs text-muted-foreground">{state}</span>}
    </div>
    {plan && <span className="shrink-0 text-xs text-muted-foreground">{plan}</span>}
  </div>
}
