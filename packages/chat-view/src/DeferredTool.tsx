import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import type { CodexFileChangeItem, CodexFileUpdateChange, CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'
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

export function DeferredTool({ remoteDetail, ...props }: PortableToolRowProps & { remoteDetail: string }) {
  const [expanded, setExpanded] = useState(false)
  const { detail, status, retry } = useDeferredToolDetail(remoteDetail, expanded, props.status !== 'streaming')
  return <PortableToolRow {...props} {...detail} autoExpand={false} hasDeferredDetails
    detailStatus={status} onExpandedChange={setExpanded} onDetailRetry={retry} />
}

/**
 * One row per changed file, as the desktop draws a Codex patch. The shell carries only
 * paths and line deltas; expanding a row loads the item once and draws that file's diff
 * in place — the loaded item is never re-rendered as rows inside the row.
 */
function DeferredCodexFileChange({ item }: { item: CodexFileChangeItem & { remoteDetail: string } }) {
  const changes = item.changes.length ? item.changes : [{ path: '', kind: 'update' as const }]
  return (
    <div className="space-y-0.5">
      {changes.map((change, index) => (
        <DeferredCodexFileChangeRow key={`${item.id}-${index}`} item={item} change={change} index={index}
          toolLineDelta={change.toolLineDelta ?? (changes.length === 1 ? item.toolLineDelta : undefined)} />
      ))}
    </div>
  )
}

function DeferredCodexFileChangeRow({ item, change, index, toolLineDelta }: {
  item: CodexFileChangeItem & { remoteDetail: string }
  change: CodexFileUpdateChange
  index: number
  toolLineDelta?: { added: number; removed: number }
}) {
  const [expanded, setExpanded] = useState(false)
  const failed = item.status === 'failed'
  const { detail, status, retry } = useDeferredToolDetail(item.remoteDetail, expanded, true)
  const loaded = detail.item?.type === 'file_change' ? detail.item.changes[index] : undefined
  return <PortableToolRow toolName="FileChange" toolUseId={`${item.id}-${index}`}
    input={JSON.stringify({ file_path: change.path, kind: change.kind })} filePath={change.path || undefined}
    toolLineDelta={toolLineDelta} toolDiff={loaded?.diff || undefined}
    status="complete"
    result={failed && index === 0 ? 'Failed to apply file changes.' : undefined} isError={failed}
    autoExpand={false} hasDeferredDetails detailStatus={status} onExpandedChange={setExpanded} onDetailRetry={retry} />
}

export function DeferredCodexTool({ item, isStreaming }: { item: CodexThreadItem; isStreaming: boolean }) {
  if (!('remoteDetail' in item) || !item.remoteDetail) return null
  if (item.type === 'file_change') return <DeferredCodexFileChange item={{ ...item, remoteDetail: item.remoteDetail }} />
  const toolName = item.type === 'command_execution' ? 'Bash' : item.type === 'mcp_tool_call' ? item.tool : item.type
  const input = item.type === 'command_execution' ? JSON.stringify({ command: item.command }) : '{}'
  const active = 'status' in item ? item.status === 'in_progress' : isStreaming
  return <DeferredTool remoteDetail={item.remoteDetail} toolName={toolName} toolUseId={item.id}
    input={input} status={active ? 'streaming' : 'complete'}
    isError={item.type === 'command_execution' ? isCodexCommandToolError(item) : 'status' in item && item.status === 'failed'} />
}
