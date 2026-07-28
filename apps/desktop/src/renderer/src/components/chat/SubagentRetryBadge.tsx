import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SubagentRetryInfo } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'

/**
 * Compact inline indicator shown while a sub-agent waits out an API rate-limit
 * backoff. Reads the `retry` slot on taskProgress; both SubagentBlock and
 * WorkflowBlock render it so a retrying agent never looks frozen.
 */
export function SubagentRetryBadge({ retry, className }: { retry: SubagentRetryInfo; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400', className)}
      title={retry.errorStatus ? String(retry.errorStatus) : retry.errorCategory}
    >
      <RotateCw className="size-3 animate-spin [animation-duration:2s]" />
      {t('chat.subagent.retrying', { attempt: retry.attempt, max: retry.maxRetries })}
    </span>
  )
}
