import type { ReactElement } from 'react'
import type { ContentBlock } from '@superone/shared/agent-types'
import { ToolBlock } from './ToolBlock'
import { getToolVerb } from './tool-display'
import {
  ToolGroupPresenter,
  type ToolGroupToolUse,
} from './presenters/ToolGroup'

export interface ToolGroupProps {
  blocks: ContentBlock[]
  sealed?: boolean
}

function renderDesktopTool(block: ToolGroupToolUse, index: number): ReactElement {
  return (
    <ToolBlock
      key={index}
      app={block.app}
      toolName={block.toolName}
      toolUseId={block.toolUseId}
      input={block.input}
      toolSummary={block.toolSummary}
      status={block.status}
      elapsedSeconds={block.elapsedSeconds}
      remoteDetail={block.remoteDetail}
    />
  )
}

/** Desktop adapter for the host-agnostic ToolGroup presenter. */
export function ToolGroup({ blocks, sealed = false }: ToolGroupProps) {
  return (
    <ToolGroupPresenter
      blocks={blocks}
      sealed={sealed}
      getToolVerb={getToolVerb}
      renderTool={(block, index) => renderDesktopTool({ ...block, app: blocks.findLast((value): value is Extract<ContentBlock, { type: 'tool_result' }> => value.type === 'tool_result' && value.toolUseId === block.toolUseId && !!value.app)?.app ?? block.app }, index)}
    />
  )
}

export { ToolGroupPresenter, generateToolGroupSummary } from './presenters/ToolGroup'
export type { ToolGroupPresenterProps, ToolGroupToolUse } from './presenters/ToolGroup'
