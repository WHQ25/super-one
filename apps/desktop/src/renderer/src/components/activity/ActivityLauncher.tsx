import { cn } from '@superone/ui/lib/utils'
import { useActivityLaunchTypes } from './activity-launch-types'

export function ActivityLauncher() {
  const types = useActivityLaunchTypes()

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="grid w-full max-w-xs gap-2">
        {types.map(({ id, icon: Icon, label, shortcut, disabled, onOpen }) => (
          <button
            key={id}
            disabled={disabled}
            onClick={() => onOpen()}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors',
              disabled ? 'opacity-40' : 'hover:border-primary/40 hover:bg-muted',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <span className="truncate text-sm text-foreground">{label}</span>
            {shortcut && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/60">{shortcut}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
