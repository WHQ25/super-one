import { useTranslation } from 'react-i18next'
import { useMemo, useState, type ReactNode } from 'react'
import type { CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'
import { isCodexCommandToolError } from '@superone/shared/codex-command-status'
import { PortableToolRow, type PortableToolRowProps } from './PortableToolRow'
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

export function DeferredTool({ remoteDetail, renderDetail, ...props }: PortableToolRowProps & { remoteDetail: string; renderDetail?: (detail: DeferredToolDetail) => ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const { detail, text, error, status, retry } = useDeferredToolDetail(remoteDetail, expanded, props.status !== 'streaming')
  return <PortableToolRow {...props} {...detail} autoExpand={false} hasDeferredDetails
    deferredContent={renderDetail && text && !error ? renderDetail(detail) : undefined}
    detailStatus={status} onExpandedChange={setExpanded} onDetailRetry={retry} />
}

export function DeferredCodexTool({ item, isStreaming, renderItem }: { item: CodexThreadItem; isStreaming: boolean; renderItem?: (item: CodexThreadItem) => ReactNode }) {
  if (!('remoteDetail' in item) || !item.remoteDetail) return null
  const toolName = item.type === 'command_execution' ? 'Bash' : item.type === 'file_change' ? 'FileChange'
    : item.type === 'mcp_tool_call' ? item.tool : item.type
  const fileChange = item.type === 'file_change' ? item.changes[0] : undefined
  const input = item.type === 'command_execution' ? JSON.stringify({ command: item.command })
    : item.type === 'file_change' ? JSON.stringify({ file_path: fileChange?.path ?? '', kind: fileChange?.kind ?? '' })
    : '{}'
  const active = 'status' in item ? item.status === 'in_progress' : isStreaming
  return <DeferredTool remoteDetail={item.remoteDetail} toolName={toolName} toolUseId={item.id}
    renderDetail={renderItem ? detail => detail.item ? renderItem(detail.item) : null : undefined}
    input={input} filePath={fileChange?.path} toolLineDelta={item.type === 'file_change' ? item.toolLineDelta : undefined}
    status={active ? 'streaming' : 'complete'}
    isError={item.type === 'command_execution' ? isCodexCommandToolError(item) : 'status' in item && item.status === 'failed'} />
}
