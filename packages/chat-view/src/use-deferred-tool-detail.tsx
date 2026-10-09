import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import type { CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'
import type { PortableToolRowProps } from './PortableToolRow'
import { useDeferredText } from './use-deferred-text'

export type DeferredToolDetail = Partial<PortableToolRowProps> & {
  item?: CodexThreadItem
  childBlocks?: ContentBlock[]
  /** A background task's own output, distinct from `result` (its launch receipt). */
  taskResultText?: string
}

/**
 * Loads the projected tool detail (`toolDetail` / `codexToolDetail` JSON) once the row
 * is expanded. `detail` is `{}` until the text lands; `status` carries the loading or
 * error copy the host row should show, and `retry` re-subscribes after a failure.
 *
 * Presenters that own their own card chrome (subagent, workflow, Codex collab,
 * dedicated SuperOne tools) call this directly so they are not wrapped in a
 * second generic tool row.
 */
export function useDeferredToolDetail(remoteDetail: string | undefined, expanded: boolean, complete: boolean) {
  const { t } = useTranslation()
  const { text, error, loading, retry } = useDeferredText(remoteDetail ? [remoteDetail] : undefined, expanded, complete)
  const detail = useMemo((): DeferredToolDetail => {
    try { return JSON.parse(text) as DeferredToolDetail } catch { return {} }
  }, [text])
  return {
    detail,
    text,
    error,
    status: error || (loading && !text ? t('common.loading') : undefined),
    retry: error ? retry : undefined,
  }
}

/** Compact status line for a deferred card body: loading copy, or the error plus a retry link. */
export function DeferredDetailStatus({ status, onRetry, className }: { status?: string; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation()
  if (!status) return null
  return (
    <div role="status" className={className ?? 'px-3 py-1.5 text-xs text-muted-foreground'}>
      {status}
      {onRetry && <button type="button" className="ml-2 underline" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  )
}
