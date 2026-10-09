import { useContext, useState } from 'react'
import { DeferredDetailStatus, useDeferredToolDetail } from './use-deferred-tool-detail'
import { PortableFileChip } from './PortableToolRow'
import { PortableTurnContext } from './portable-turn-context'
import { AnsiText } from './presenters/ansi'
import { CodexCommandBlockPresenter } from './presenters/CodexCommandBlock'
import type { CodexCommandPresenterProps } from './presenters/CodexTurnView'

export function PortableCodexCommand({ item, isStreaming }: CodexCommandPresenterProps) {
  const { projectPath } = useContext(PortableTurnContext)
  const [expanded, setExpanded] = useState(false)
  const { detail, status, retry } = useDeferredToolDetail(item.remoteDetail, expanded, item.status !== 'in_progress')
  // Older hosts return input/result only; newer ones also include command metadata.
  let command = item.command
  try { const input = JSON.parse(detail.input ?? '{}'); if (typeof input.command === 'string') command = input.command } catch { /* retain shell */ }
  const loaded = detail.item?.type === 'command_execution'
    ? { ...detail.item, aggregatedOutput: detail.result ?? detail.item.aggregatedOutput, status: item.status, exitCode: item.exitCode ?? detail.item.exitCode }
    : { ...item, command, aggregatedOutput: detail.result ?? item.aggregatedOutput }
  return <div data-tool-use-id={item.id} className="min-w-0">
    <CodexCommandBlockPresenter item={loaded} isStreaming={isStreaming} cwd={projectPath ?? undefined}
      expanded={expanded} onExpandedChange={setExpanded}
      detailStatus={<DeferredDetailStatus status={status} onRetry={retry} />}
      renderFileChip={path => <PortableFileChip name={path.split(/[/\\]/).pop() || path} title={path} filePath={path} />}
      renderAnsiText={text => <AnsiText text={text} />} />
  </div>
}
