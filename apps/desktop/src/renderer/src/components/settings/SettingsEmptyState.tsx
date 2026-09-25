import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

/**
 * Stand-in content for an empty list on a settings card: centered muted copy
 * with an optional primary action. Place it inside `SettingsSection` /
 * `SettingsCard`; it carries no card chrome of its own.
 */
export function SettingsEmptyState({ title, hint, action, className }: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('px-3 py-8 text-center', className)}>
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs break-words text-muted-foreground">{hint}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}

/** Stand-in content for a list on a settings card that is still loading. */
export function SettingsLoadingState({ label, className }: { label: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 px-3 py-8', className)}>
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}
