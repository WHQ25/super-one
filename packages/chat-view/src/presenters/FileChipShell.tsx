import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'

interface FileChipShellProps extends Omit<ComponentPropsWithRef<'span'>, 'title' | 'className' | 'children'> {
  icon: ReactNode
  name: string
  title?: string
  /** Already formatted, e.g. `#L12-20`. */
  lineRange?: string
  /** Applied to the label so a caller can widen or clamp it. */
  className?: string
}

/**
 * The visual shell every file chip shares — desktop tool rows, markdown links and the
 * WebView row alike. Only the icon and the click behaviour are platform-bound (the
 * desktop drags the file and opens a tab, the phone asks the native shell), so those
 * arrive as props and the chrome stays in one place.
 *
 * Remaining props land on the outer span, and `ref` forwards to it, so the desktop can
 * hand the chip to a Radix `asChild` trigger for its context menu.
 */
export function FileChipShell({ icon, name, title, lineRange, className, ...rest }: FileChipShellProps) {
  return (
    <span
      role="button"
      title={title}
      {...rest}
      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground hover:bg-muted/80 transition-colors"
    >
      {icon}
      <span className={cn('truncate', className)}>{name}</span>
      {lineRange && <span className="text-muted-foreground text-xs">{lineRange}</span>}
    </span>
  )
}
