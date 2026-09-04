import { useMemo, type ReactNode } from 'react'
import type {
  ChatMessage as ChatMessageType,
  CodexThreadItem,
} from '@superone/shared/agent-types'
import { CopyableMarkdown } from './CopyableMarkdown'
import { fileLinkComponents } from './chat-markdown-components'
import { CodexCommandBlock, renderCodexItem } from './codex-item-renderer'
import {
  CodexSubagentMarker,
  isSpawnReady,
  isSubagentFollowUp,
} from './CodexCollabBlock'
import { ImageGalleryBlock } from './ImageGalleryBlock'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { ToolBlock } from './ToolBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { isAlwaysHiddenToolBlock, isHiddenToolBlock } from './tool-display'
import { isMediaGenerateImageTool, isMediaVideoStatusTool } from './media-generation'
import { summarizeCodexProcess } from './turn-process-stats'
import { TurnDetailSection } from './TurnDetailSection'
import { isCodexPinnedSegment } from './compact-chat-mode'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useMiniAppStore } from '@/stores/miniapp'
import {
  CodexTurnViewPresenter,
  codexMcpItemResultText,
  type CodexItemPresenterProps,
  type CodexTurnViewPresenterParts,
  type CodexTurnViewPresenterRuntime,
} from './presenters/CodexTurnView'

function isHiddenCodexMcpItem(item: CodexThreadItem): boolean {
  if (item.type !== 'mcp_tool_call') return false
  const toolName = `mcp__${item.server}__${item.tool}`
  if (isAlwaysHiddenToolBlock(toolName)) return true
  if (!isMediaGenerateImageTool(toolName) && !isMediaVideoStatusTool(toolName)) return false
  return isHiddenToolBlock(toolName, codexMcpItemResultText(item))
}

function DesktopMarkdown({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <CopyableMarkdown
      text={text}
      isStreaming={isStreaming}
      components={fileLinkComponents}
    />
  )
}

function DesktopCodexItem({
  item,
  index,
  isStreaming,
  nextItem,
  onApprovePlan,
  onRejectPlan,
  planApproval,
}: CodexItemPresenterProps) {
  return renderCodexItem(
    item,
    index,
    isStreaming,
    nextItem,
    onApprovePlan,
    onRejectPlan,
    planApproval,
  )
}

const DESKTOP_PARTS: CodexTurnViewPresenterParts = {
  Markdown: DesktopMarkdown,
  CodexItem: DesktopCodexItem,
  Command: CodexCommandBlock,
  Subagent: CodexSubagentMarker,
  Reasoning: ReasoningBlock,
  Tool: ToolBlock,
  ImageGallery: ImageGalleryBlock,
  TurnDetail: TurnDetailSection,
  AppIcon: MiniAppIcon,
}

const DESKTOP_RUNTIME: CodexTurnViewPresenterRuntime = {
  isHiddenMcpItem: isHiddenCodexMcpItem,
  isSpawnReady,
  isSubagentFollowUp,
  isPinnedSegment: isCodexPinnedSegment,
  summarizeProcess: summarizeCodexProcess,
}

interface CodexTurnViewProps {
  message: ChatMessageType
  isStreaming: boolean
  isWorking?: boolean
  isLastAssistant: boolean
  collapseEntireTurn?: boolean
  footer?: ReactNode
}

/** Desktop host adapter for the portable Codex turn presenter. */
export function CodexTurnView(props: CodexTurnViewProps) {
  const detailChatMode = useAppStore((state) => state.detailChatMode)
  const selectedCodexCollaborationMode = useActiveSession(
    (state) => state.selectedCodexCollaborationMode,
  )
  const hasPendingInteraction = useActiveSession((state) => state.hasPendingInteraction)
  const approveCodexPlan = useChatStore((state) => state.approveCodexPlan)
  const rejectCodexPlan = useChatStore((state) => state.rejectCodexPlan)
  const apps = useMiniAppStore((state) => state.apps)
  const { groupableAppByTool, appNameById } = useMemo(() => {
    const groupable = new Map<string, string>()
    const names = new Map<string, string>()
    for (const app of apps) {
      names.set(app.id, app.manifest.name ?? app.id)
      for (const tool of app.manifest.tools ?? []) {
        if (tool.groupable) groupable.set(`${app.id}\0${tool.name}`, app.id)
      }
    }
    return { groupableAppByTool: groupable, appNameById: names }
  }, [apps])

  return (
    <CodexTurnViewPresenter
      {...props}
      detailChatMode={detailChatMode}
      canRespondToPlan={
        selectedCodexCollaborationMode === 'plan' && !hasPendingInteraction
      }
      onApprovePlan={approveCodexPlan}
      onRejectPlan={rejectCodexPlan}
      groupableAppByTool={groupableAppByTool}
      appNameById={appNameById}
      parts={DESKTOP_PARTS}
      runtime={DESKTOP_RUNTIME}
    />
  )
}

export {
  CodexTurnViewPresenter,
  codexMcpItemResultText,
  type CodexTurnViewPresenterProps,
} from './presenters/CodexTurnView'
