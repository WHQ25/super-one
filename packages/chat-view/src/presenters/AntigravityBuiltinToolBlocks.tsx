import type { ReactNode } from 'react'
import { DefineSubagentToolBlockPresenter } from './DefineSubagentToolBlock'
import { ManageSubagentsToolBlockPresenter } from './ManageSubagentsToolBlock'
import { ManageTaskToolBlockPresenter } from './ManageTaskToolBlock'
import { McpResourceToolBlockPresenter } from './McpResourceToolBlock'
import { isMcpResourceToolName } from './mcp-resource-display'
import { ScheduleToolBlockPresenter } from './ScheduleToolBlock'
import {
  PostMessageToolBlockPresenter,
  ReadBoardToolBlockPresenter,
  SwarmWaitToolBlockPresenter,
} from './SwarmToolBlocks'

export interface AntigravityBuiltinToolRenderInput {
  toolName: string
  params: Record<string, unknown>
  result?: string | null
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  allowExpand?: boolean
}

export function renderAntigravityBuiltinToolBlock({
  toolName,
  params,
  result,
  isStreaming,
  isError,
  isDenied,
  allowExpand = true,
}: AntigravityBuiltinToolRenderInput): ReactNode | null {
  if (toolName === 'ManageTask' || toolName === 'manage_task') {
    return (
      <ManageTaskToolBlockPresenter
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (toolName === 'ManageSubagents' || toolName === 'manage_subagents') {
    return (
      <ManageSubagentsToolBlockPresenter
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (toolName === 'Schedule' || toolName === 'schedule') {
    return (
      <ScheduleToolBlockPresenter
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (toolName === 'DefineSubagent' || toolName === 'define_subagent') {
    return (
      <DefineSubagentToolBlockPresenter
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (toolName === 'ReadBoard' || toolName === 'read_board') {
    return (
      <ReadBoardToolBlockPresenter
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (toolName === 'PostMessage' || toolName === 'post_message') {
    return (
      <PostMessageToolBlockPresenter
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (toolName === 'SwarmWait' || toolName === 'swarm_wait') {
    return (
      <SwarmWaitToolBlockPresenter
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  if (isMcpResourceToolName(toolName)) {
    return (
      <McpResourceToolBlockPresenter
        toolName={toolName}
        params={params}
        result={result}
        isStreaming={isStreaming}
        isError={isError}
        isDenied={isDenied}
        allowExpand={allowExpand}
      />
    )
  }
  return null
}
