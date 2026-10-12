import { isWidgetShowTool } from './media-generation'
import {
  isClaudePinnedSegment as isClaudePinnedSegmentPresenter,
  isPinnedToolName as isPinnedToolNamePresenter,
} from './presenters/compact-chat-mode'

const desktopCompactChatModePorts = { isWidgetShowTool }

export {
  MIN_PROCESS_SEGMENTS_TO_COLLAPSE,
  collapsibleItems,
  countVisibleClaudeProcessSegments,
  isVisibleClaudeProcessSegment,
  partitionTurnForCompactMode,
} from './presenters/compact-chat-mode'
export type {
  ClaudeSegmentVisibilityOpts,
  CompactChatModePorts,
  TurnRun,
} from './presenters/compact-chat-mode'

export function isPinnedToolName(toolName: string): boolean {
  return isPinnedToolNamePresenter(toolName, desktopCompactChatModePorts)
}

export function isClaudePinnedSegment(seg: {
  kind: string
  block?: { type: string; toolName?: string }
}): boolean {
  return isClaudePinnedSegmentPresenter(seg, desktopCompactChatModePorts)
}
