import type { TaskNotificationMeta } from '@superone/shared/agent-types'
import { BellRing } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'
import { formatCompactDuration, formatCompactTokens } from './ChatMessage'

const STATUS_TONE: Record<TaskNotificationMeta['status'], string> = {
  completed: 'text-success',
  failed: 'text-error',
  stopped: 'text-warning',
}

/** Trailing path segment — the full path lives in the tooltip. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * Compact "the agent was woken by a background task" row.
 *
 * Minted when the launching tool block is gone or only lives in an earlier
 * turn (see `buildOrphanTaskNotificationMessage`). A still-visible current-turn
 * block already shows the same outcome. Right-aligned like the collaboration
 * mailbox wake: both are inputs that reached the agent without the user typing.
 */
export function TaskNotificationRow({ meta }: { meta: TaskNotificationMeta }) {
  const { t } = useTranslation()
  const label = t(`chat.taskNotification.${meta.status}`)
  const usage = meta.usage

  return (
    <div className="mb-0.5 flex w-0 min-w-full justify-end" data-task-notification={meta.status} role="note">
      <div className="flex max-w-[90%] min-w-0 flex-col items-end gap-0.5 px-0.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <BellRing className={cn('size-3 shrink-0', STATUS_TONE[meta.status])} aria-hidden />
          <span className="shrink-0">{label}</span>
          {meta.description && (
            <span className="truncate font-mono text-[0.95em] text-muted-foreground/80">{meta.description}</span>
          )}
          {usage && usage.durationMs > 0 && (
            <span className="shrink-0 text-muted-foreground/70">· {formatCompactDuration(usage.durationMs)}</span>
          )}
          {usage && usage.totalTokens > 0 && (
            <span className="shrink-0 text-muted-foreground/70">· {formatCompactTokens(usage.totalTokens)}</span>
          )}
          {meta.outputFile && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 truncate text-muted-foreground/70">· {basename(meta.outputFile)}</span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="font-mono text-xs">{meta.outputFile}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {meta.summary && (
          <div className="line-clamp-2 max-w-full text-right leading-snug text-muted-foreground/80">
            {meta.summary}
          </div>
        )}
      </div>
    </div>
  )
}
