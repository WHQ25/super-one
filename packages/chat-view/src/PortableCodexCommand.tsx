import { isCodexCommandToolError } from '@superone/shared/codex-command-status'
import { DeferredCodexTool } from './DeferredTool'
import { PortableToolRow } from './PortableToolRow'
import type { CodexCommandPresenterProps } from './presenters/CodexTurnView'

export function PortableCodexCommand({ item, isStreaming }: CodexCommandPresenterProps) {
  if (item.remoteDetail) return <DeferredCodexTool item={item} isStreaming={isStreaming} />
  const action = item.commandActions?.[0]
  const toolName = action?.type === 'read' ? 'Read' : action?.type === 'search' ? 'Grep' : 'Bash'
  const input = toolName === 'Read'
    ? { file_path: action?.path ?? item.command }
    : toolName === 'Grep'
      ? { pattern: action?.query ?? '', path: action?.path }
      : { command: item.command }
  return (
    <PortableToolRow
      toolName={toolName}
      toolUseId={item.id}
      input={JSON.stringify(input)}
      toolSummary={action?.path ?? action?.query ?? item.command}
      result={`${item.aggregatedOutput}${item.exitCode !== undefined ? `\n\nExit code ${item.exitCode}` : ''}`.trim() || undefined}
      status={isStreaming && item.status === 'in_progress' ? 'streaming' : 'complete'}
      isError={isCodexCommandToolError(item)}
    />
  )
}

