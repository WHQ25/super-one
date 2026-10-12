import type { ChatMessage as ChatMessageType, AgentStatus, ContentBlock, ImageGenerationItem, VideoGenerationItem } from '@superone/shared/agent-types'
import { ModMessageScope } from '@superone/chat-view/mod-ui'
import { useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { Pencil } from 'lucide-react'
import { ToolBlock } from './ToolBlock'
import { ToolGroup } from './ToolGroup'
import { AppToolGroup } from './AppToolGroup'
import { parseToolInput, isHiddenToolBlock, collectGeneratedImages, collectGeneratedVideos } from './tool-display'
import {
  isClaudePinnedSegment,
} from './compact-chat-mode'
import { summarizeClaudeProcess } from './turn-process-stats'
import { TurnDetailSection } from './TurnDetailSection'
import { collectCodexGeneratedImages, collectCodexGeneratedVideos } from './media-generation'
import { useMiniAppStore } from '@/stores/miniapp'
import { SubagentBlock } from './SubagentBlock'
import { WorkflowBlock } from './WorkflowBlock'
import { CodexTurnView } from './CodexTurnView'
import { ImageGalleryBlock } from './ImageGalleryBlock'
import { VideoGalleryBlock } from './VideoGalleryBlock'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { getActiveSessionView, useActiveSession, useChatStore, useSessionScope } from '@/stores/chat'
import { codexAsyncAnswerCopyText, codexAsyncAnswerQuestions, codexAsyncReplyText, isCodexAsyncAnswer, isDismissedCodexAsyncAnswer } from '@superone/shared/codex-async-question'
import { useAppStore } from '@/stores/app'
import { getAssistantCopyText } from './chat-message/getAssistantCopyText'
import { resolveMarkdownFileLinks } from './chat-shared'
import { RewindButton } from './RewindButton'
import { SendFailureResendButton } from '@superone/chat-view/presenters/SendFailureResendButton'
import { CopyableMarkdown, InsightBlock } from './CopyableMarkdown'
import { CollabTaskBubble } from './CollabTaskBubble'
import { CopyButton, useCopyFeedback } from './chat-message/copy-button'
import { userCopyHtml } from './chat-message/user-copy-html'
import { userMessageParts } from '@superone/shared/user-message-parts'
import { tryCopy, tryCopyRich } from '@/lib/clipboard'
import { fileLinkComponents } from './chat-markdown-components'
import { DesktopReasoning, ReasoningBlock } from './ReasoningBlock'
import { promptKeywordsIn } from '@superone/shared/prompt-keywords'
import { UserMessageContentPresenter } from '@superone/chat-view/presenters/UserMessageContent'
import { MessageContextChips } from '@superone/chat-view/presenters/MessageContextChips'
import { MessageTimestamp } from '@superone/chat-view/presenters/MessageTime'
import { DesktopUserBubblePorts } from './user-bubble-ports'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { useActiveHarness } from '@/hooks/useHarnessTheme'
import { replaceMiniAppTagsWithMention } from '@superone/shared/miniapp-prompt-tags'
import { TurnSummaryAboveFooter } from './presenters/ChatMessageIndicators'
import { DurationFooter } from './ChatMessageFooter'
import { VirtualTurnSegment } from './VirtualTranscriptBlock'
import { collaborationLabelKey, isModelOnlyWakeMessage } from '@superone/chat-view/presenters/collaboration-label'
import { goalMessageObjective } from '@superone/shared/session-goal'
import { parseRealtimeDelegation } from '@superone/shared/realtime-timeline'
import { RealtimeDelegationBody } from '@superone/chat-view/presenters/RealtimeDelegationBody'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { ChatMessagePresenter } from './presenters/ChatMessage'
import {
  TurnBlockPresenter,
  TurnBodyPresenter,
  type TurnDocumentPresenterProps,
  type TurnBodyPresenterParts,
  type TurnBodyPresenterRuntime,
} from './presenters/TurnBody'
import type { CodexTurnDetailPresenterProps } from './presenters/CodexTurnView'
import {
  groupContent,
} from './chat-message/groupContent'

export { groupContent }
export * from './presenters/ChatMessageIndicators'

interface ChatMessageProps {
  message: ChatMessageType
  sourceMessage?: ChatMessageType
  showFooter?: boolean
  sessionStatus: AgentStatus
  isLastAssistant: boolean
  hideUserActions?: boolean
  hideCopyActions?: boolean
  collapseEntireCodexTurn?: boolean
}

// Keep file-link resolution and parsed media rendering scoped to this text block.
function TextBlock({ text, isStreaming, projectPath, afterThinking }: {
  text: string
  isStreaming: boolean
  projectPath?: string | null
  afterThinking?: boolean
}) {
  const resolved = projectPath ? resolveMarkdownFileLinks(text, projectPath) : text
  return (
    <div className={afterThinking ? 'mt-1 after-thinking' : undefined}>
      <CopyableMarkdown projectPath={projectPath} text={resolved} isStreaming={isStreaming} components={fileLinkComponents} />
    </div>
  )
}

function DesktopDocumentIcon({ name }: TurnDocumentPresenterProps) {
  return <FileIcon name={name} size={14} />
}

const TURN_PARTS: TurnBodyPresenterParts = {
  Text: TextBlock,
  Insight: InsightBlock,
  Document: DesktopDocumentIcon,
  Tool: ToolBlock,
  Reasoning: DesktopReasoning,
  Subagent: SubagentBlock,
  Workflow: WorkflowBlock,
  ToolGroup,
  AppToolGroup,
  TurnDetail: TurnDetailSection,
}

function LongTurnDetail(props: CodexTurnDetailPresenterProps) {
  return <TurnDetailSection {...props} animate={false} />
}

const LONG_CONTENT_BLOCK_TURN_PARTS: TurnBodyPresenterParts = {
  ...TURN_PARTS, Segment: VirtualTurnSegment, TurnDetail: LongTurnDetail,
}

const TURN_RUNTIME: TurnBodyPresenterRuntime = {
  isBackgroundTool(block) {
    if (block.toolName !== 'Bash') return false
    const params = parseToolInput(block.input, block.toolName)
    return params.run_in_background === true || params.background === true
  },
  isPinnedSegment: isClaudePinnedSegment,
  isHiddenTool: isHiddenToolBlock,
  summarizeProcess: summarizeClaudeProcess,
}

/** A tool call a user message carries, drawn like one in an assistant turn. */
function UserContentBlock({ block, index }: { block: ContentBlock; index: number }) {
  return <TurnBlockPresenter block={block} index={index} isStreaming={false} parts={TURN_PARTS} runtime={TURN_RUNTIME} />
}

export const ChatMessage = memo(function ChatMessage({
  message,
  sourceMessage = message,
  showFooter = true,
  sessionStatus,
  isLastAssistant,
  hideUserActions,
  hideCopyActions,
  collapseEntireCodexTurn,
}: ChatMessageProps) {
  const { t } = useTranslation()
  const projectPath = useChatStore((s) => s.activeProject)
  const detailChatMode = useAppStore((s) => s.detailChatMode)
  const isUser = message.role === 'user'
  const asyncQuestions = useActiveSession(session => codexAsyncAnswerQuestions(message, session.messages))
  const isStreaming = message.status === 'streaming' && sessionStatus === 'streaming' && isLastAssistant
  const isWorking = message.status === 'streaming'
    && (sessionStatus === 'streaming' || sessionStatus === 'background')
    && isLastAssistant
  const isCodexMessage = !isUser && message.providerId === 'codex'
  const collabLabelKey = isUser ? collaborationLabelKey(message) : null
  const isCollab = collabLabelKey != null
  // Parent-handed launch task: right-aligned markdown bubble (see CollabTaskBubble).
  // Mailbox traffic keeps the compact left-aligned label + plain-text bubble below.
  const isInitialTask = isCollab && message.metadata?.collaboration?.kind === 'initial_task'
  // Copy text is only needed once the turn settles (the copy button is hidden while streaming),
  // so skip deriving the full concatenated text on every delta of the live message.
  const assistantCopyText = isStreaming || hideCopyActions ? undefined : getAssistantCopyText(sourceMessage)

  const apps = useMiniAppStore((s) => s.apps)
  const grouped = useMemo(
    () => (isUser || isCodexMessage) ? null : groupContent(message.content, apps),
    [isUser, isCodexMessage, message.content, apps],
  )

  const codexItems = message.metadata?.codex?.items
  const generatedImages = useMemo(
    () => isCodexMessage
      ? collectCodexGeneratedImages(codexItems)
      : grouped ? collectGeneratedImages(message.content, grouped.toolResultMap) : [],
    [isCodexMessage, codexItems, grouped, message.content],
  )

  const generatedVideos = useMemo(
    () => isCodexMessage
      ? collectCodexGeneratedVideos(codexItems)
      : grouped ? collectGeneratedVideos(message.content, grouped.toolResultMap) : [],
    [isCodexMessage, codexItems, grouped, message.content],
  )

  const userText = useMemo(
    () => (isUser
      ? replaceMiniAppTagsWithMention(message.content.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('\n'))
      : ''),
    [isUser, message.content],
  )
  // A sent `/goal …` reads as the objective under a Goal label, not as a slash line.
  const goalObjective = isUser && !isCodexAsyncAnswer(message) ? goalMessageObjective(userText) : null
  // The keywords this session's harness acted on; a goal shows its objective
  // without the `/goal` the harness saw, so scan the whole sent text.
  const harness = useActiveHarness()
  const promptKeywords = useMemo(
    () => (isUser ? promptKeywordsIn(userText, HARNESS_CAPABILITIES[harness].promptKeywords) : []),
    [isUser, harness, userText],
  )
  // A `<realtime_delegation>` envelope is what the voice agent asked Codex to do:
  // an ordinary user bubble under a Voice label, linking back to the spoken turn.
  const delegation = isUser && !isCodexAsyncAnswer(message) ? parseRealtimeDelegation(userText) : null
  // Resolved on click, not subscribed: every bubble mounts this component and
  // only the rare delegation row needs to know which session it belongs to.
  const scope = useSessionScope()
  const jumpToVoiceTurn = () => {
    const sessionId = scope?.sessionId ?? getActiveSessionView(scope)._activeSessionId
    if (!sessionId) return
    const turnId = message.metadata?.codexTimeline?.turnId
    useCodexRealtimeViewStore.getState().jumpTo(sessionId, {
      view: 'realtime',
      ...(turnId ? { turnId } : { messageId: message.id }),
    })
  }
  // Text, images, mentions and paste chips in message order: the copy's HTML
  // flavour keeps each chip where it sat, so pasting restores the message.
  const userCopyParts = useMemo(() => (isUser ? userMessageParts(message) : []), [isUser, message])
  const hasUserImages = userCopyParts.some((part) => 'attachment' in part && part.attachment.mimeType.startsWith('image/'))
  const hasUserChips = hasUserImages || userCopyParts.some((part) => 'mention' in part || 'paste' in part)
  const { copied: userCopied, run: runUserCopy } = useCopyFeedback()
  const asyncCopyText = asyncQuestions ? codexAsyncAnswerCopyText(asyncQuestions, codexAsyncReplyText(message) ?? '') : null
  const copyUserMessage = () => runUserCopy(() => (asyncCopyText ? tryCopy(asyncCopyText) : hasUserChips
    ? tryCopyRich(userText, userCopyHtml(userCopyParts))
    : tryCopy(userText)))
  const assistantFooter = !isUser && showFooter ? (
    <DurationFooter
      message={message}
      copyText={assistantCopyText}
      parentIsStreaming={isStreaming}
      className={message.metadata?.turnSummary ? 'mt-1' : undefined}
    />
  ) : null
  const body = delegation ? (
    <RealtimeDelegationBody delegation={delegation} />
  ) : isUser ? (
    <UserMessageContentPresenter message={message} text={goalObjective} promptKeywords={promptKeywords} Block={UserContentBlock} asyncQuestions={asyncQuestions} />
  ) : isCodexMessage ? (
    <CodexTurnView
      message={message}
      isStreaming={isStreaming}
      isWorking={isWorking}
      isLastAssistant={isLastAssistant}
      virtualize={(sourceMessage.metadata?.codex?.items.length ?? 0) >= 80}
      collapseEntireTurn={collapseEntireCodexTurn}
      footer={collapseEntireCodexTurn ? assistantFooter : undefined}
    />
  ) : (
    <ModMessageScope messageId={message.id}>
      <TurnBodyPresenter
        grouped={grouped!}
        isStreaming={isStreaming}
        detailChatMode={detailChatMode}
        projectPath={projectPath}
        parts={(grouped!.segments.length >= 80 || sourceMessage.content.length >= 80) ? LONG_CONTENT_BLOCK_TURN_PARTS : TURN_PARTS}
        runtime={TURN_RUNTIME}
      />
    </ModMessageScope>
  )
  const sendFailure = isUser ? message.metadata?.sendFailure : undefined
  const userActions = isUser && !hideCopyActions && (
    (!isCollab && !hideUserActions) || (isCollab && userText.length > 0)
  ) ? (
    <div className="relative mt-1 flex items-center gap-1 opacity-0 group-hover/copy:opacity-100">
      <MessageTimestamp iso={message.createdAt} className="mr-1 text-xs" />
      {!isCollab && !isCodexAsyncAnswer(message) && message.checkpointId && (
        <RewindButton
          checkpointId={message.checkpointId}
          rewound={message.rewound}
          className="opacity-100"
        />
      )}
      {(userText.length > 0 || hasUserImages) && (
        <CopyButton
          copied={userCopied}
          onClick={() => void copyUserMessage()}
          className="opacity-100"
        />
      )}
      {sendFailure && (
        <button
          type="button"
          title={t('chat.sendFailure.edit')}
          aria-label={t('chat.sendFailure.edit')}
          onClick={() => useChatStore.getState().editFailedMessage(message.id, scope ?? undefined)}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
      )}
    </div>
  ) : undefined

  if (isModelOnlyWakeMessage(message) || isDismissedCodexAsyncAnswer(message)) return null

  return (
    <DesktopUserBubblePorts>
      <ChatMessagePresenter
        isUser={isUser}
        isCollaboration={isCollab}
        collaborationLabel={collabLabelKey ? t(collabLabelKey) : undefined}
        goalLabel={goalObjective ? t('chat.goal.label') : undefined}
        voiceLabel={delegation ? t('chat.realtimeVoice.delegation.label') : undefined}
        onVoiceLabelClick={delegation ? jumpToVoiceTurn : undefined}
        initialTask={isInitialTask
          ? <CollabTaskBubble text={userText} from={message.metadata?.collaboration} />
          : undefined}
        body={body}
        imageGallery={generatedImages.length > 0
          ? <ImageGalleryBlock items={generatedImages} />
          : undefined}
        videoGallery={generatedVideos.length > 0
          ? <VideoGalleryBlock items={generatedVideos} />
          : undefined}
        interrupted={message.status === 'interrupted'}
        interruptedLabel={t('chat.interrupted')}
        turnSummary={showFooter && message.metadata?.turnSummary
          ? <TurnSummaryAboveFooter summary={message.metadata.turnSummary} />
          : undefined}
        assistantFooter={assistantFooter}
        footerInsideBody={!!collapseEntireCodexTurn}
        contexts={message.contexts && message.contexts.length > 0
          ? <MessageContextChips contexts={message.contexts} />
          : undefined}
        sendFailure={sendFailure
          ? (
            <SendFailureResendButton
              error={sendFailure.error}
              onResend={() => { void useChatStore.getState().resendFailedMessage(message.id, scope ?? undefined) }}
            />
          )
          : undefined}
        userActions={userActions}
      />
    </DesktopUserBubblePorts>
  )
})
