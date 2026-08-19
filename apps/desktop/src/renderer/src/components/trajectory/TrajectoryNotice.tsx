import type { ComponentType, ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'

export interface TrajectoryNoticeProps {
  icon: ComponentType<{ className?: string }>
  title: string
  detail: string
  /** Verbatim backend text, shown only when there is something to diagnose. */
  diagnostic?: string
  /** Marks a real failure; absence and emptiness are ordinary states. */
  failed?: boolean
  action?: ReactNode
}

/**
 * The panel's non-ledger states.
 *
 * Absence, emptiness, and failure share one shape but not one tone: only a
 * failure gets the destructive accent, so "this session has not run yet" does
 * not read as something the user broke.
 */
export function TrajectoryNotice({
  icon: Icon,
  title,
  detail,
  diagnostic,
  failed = false,
  action,
}: TrajectoryNoticeProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <Icon className={cn('size-8', failed ? 'text-destructive/70' : 'text-muted-foreground/40')} />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        {diagnostic !== undefined && (
          <pre className="max-h-32 w-full overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 text-left font-mono text-[11px] text-muted-foreground">
            {diagnostic}
          </pre>
        )}
        {action}
      </div>
    </div>
  )
}
