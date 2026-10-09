import { useState } from 'react'
import type { CodexFileChangeItem, CodexFileUpdateChange, CodexThreadItem } from '@superone/shared/agent-types'
import { PortableToolRow, type PortableToolRowProps } from './PortableToolRow'
import { useDeferredToolDetail } from './use-deferred-tool-detail'
export { useDeferredToolDetail, DeferredDetailStatus, type DeferredToolDetail } from './use-deferred-tool-detail'
import { PortableCodexCommand } from './PortableCodexCommand'

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
    input={JSON.stringify({ file_path: change.path, kind: change.kind, diff: loaded?.diff ?? '' })} filePath={change.path || undefined}
    toolLineDelta={toolLineDelta}
    status="complete"
    result={failed && index === 0 ? 'Failed to apply file changes.' : undefined} isError={failed}
    autoExpand={false} hasDeferredDetails detailStatus={status} onExpandedChange={setExpanded} onDetailRetry={retry} />
}

export function DeferredCodexTool({ item, isStreaming }: { item: CodexThreadItem; isStreaming: boolean }) {
  if (!('remoteDetail' in item) || !item.remoteDetail) return null
  if (item.type === 'file_change') return <DeferredCodexFileChange item={{ ...item, remoteDetail: item.remoteDetail }} />
  if (item.type === 'command_execution') return <PortableCodexCommand item={item} isStreaming={isStreaming} />
  const toolName = item.type
  const input = '{}'
  const active = 'status' in item ? item.status === 'in_progress' : isStreaming
  return <DeferredTool remoteDetail={item.remoteDetail} toolName={toolName} toolUseId={item.id}
    input={input} status={active ? 'streaming' : 'complete'}
    isError={'status' in item && item.status === 'failed'} />
}
