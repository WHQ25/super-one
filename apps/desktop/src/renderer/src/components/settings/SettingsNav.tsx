import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'

/**
 * List navigation shared by the settings sidebar and in-page master lists
 * (providers), so both levels select and group the same way.
 */

export function SettingsNavGroup({ label, className, children }: {
  label?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {label && <div className="px-3 pt-4 pb-1 text-xs text-muted-foreground">{label}</div>}
      {children}
    </div>
  )
}

export function SettingsNavItem({ selected, dimmed, icon, trailing, size = 'default', className, children, ...props }: ComponentProps<'button'> & {
  selected?: boolean
  /** Rendered faded, for entries that exist but are not in use yet. */
  dimmed?: boolean
  icon?: ReactNode
  trailing?: ReactNode
  /** `lg` is for in-page master lists (providers, harnesses) whose entries carry brand logos. */
  size?: 'default' | 'lg'
}) {
  const large = size === 'lg'
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex w-full min-w-0 items-center text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        large ? 'gap-2.5 rounded-lg px-3 py-2.5 text-base font-medium' : 'gap-3 rounded-md px-3 py-2 text-sm',
        selected
          ? cn('bg-muted/70 text-foreground', !large && 'font-medium')
          : cn('hover:bg-muted/40 hover:text-foreground', large ? 'text-foreground' : 'text-muted-foreground'),
        dimmed && !selected && 'opacity-60',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{trailing}</span>}
    </button>
  )
}
