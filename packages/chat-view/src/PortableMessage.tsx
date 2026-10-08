import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { CircleStop, Puzzle, RefreshCw, TriangleAlert } from 'lucide-react'
import { ChatMessagePresenter } from './presenters/ChatMessage'
import { TurnSummaryAboveFooter } from './presenters/ChatMessageIndicators'
import { collaborationLabelKey, isModelOnlyWakeMessage } from './presenters/collaboration-label'
import { goalMessageObjective } from '@superone/shared/session-goal'
import { promptKeywordsIn, type PromptKeyword } from '@superone/shared/prompt-keywords'
import { parseRealtimeDelegation } from '@superone/shared/realtime-timeline'
import { RealtimeDelegationBody } from './presenters/RealtimeDelegationBody'
import { getAssistantCopyText } from './presenters/getAssistantCopyText'
import { ZERO_TURN_TOKENS, type TurnTokenCounts } from './presenters/turn-footer-model'
import { PortableCollabTaskBubble } from './PortableCollabTaskBubble'
import { UserMessageContentPresenter } from './presenters/UserMessageContent'
import { MessageContextChips } from './presenters/MessageContextChips'
import { PortableUserBubblePorts } from './portable-user-bubble-ports'
import { PortableToolRow } from './PortableToolRow'
import { PortableTurnFooter } from './PortableTurnFooter'
import {
  PortableClaudeTurn,
  PortableCodexTurn,
  PortableImageGallery,
  PortableTurnProvider,
  PortableVideoGallery,
  portableToolBlocks,
  portableToolResultText,
} from './PortableTurnAdapters'
import {
  collectCodexGeneratedImages,
  collectCodexGeneratedVideos,
} from './presenters/media-generation'
import { collectGeneratedImages, collectGeneratedVideos } from './presenters/tool-display'
import type { ReductionProjection } from './protocol'
import { useUserMessageMenu } from './use-user-message-menu'
import { SendFailureResendButton } from './presenters/SendFailureResendButton'
import { requestNative } from './bridge'

type PendingPermission = NonNullable<ReductionProjection['pendingPermission']>

const NO_KEYWORDS: readonly PromptKeyword[] = []

function resultsByTool(content: ContentBlock[]): Map<string, { result: string; isError: boolean }> {
  const results = new Map<string, { result: string; isError: boolean }>()
  for (const block of content) {
    if (block.type === 'tool_result') {
      results.set(block.toolUseId, { result: block.summary, isError: Boolean(block.isError) })
    } else if (block.type === 'bash_result' || block.type === 'todo_result') {
      results.set(block.toolUseId, { result: block.summary, isError: false })
    }
  }
  return results
}

/** A tool call a user message carries, as a tool row with the result the message holds for it. */
function UserToolBlock({ block, index, message }: { block: ContentBlock; index: number; message: ChatMessage }) {
  if (!('toolName' in block && 'toolUseId' in block && 'input' in block)) return null
  const result = resultsByTool(message.content).get(block.toolUseId)
  return (
    <PortableToolRow
      key={`${block.toolUseId}-${index}`}
      toolName={block.toolName}
      toolUseId={block.toolUseId}
      input={block.input}
      toolSummary={block.toolSummary}
      status={block.status}
      result={result?.result}
      isError={result?.isError}
      toolDiff={block.toolDiff}
      toolDiffTokens={block.toolDiffTokens}
      toolLineDelta={block.toolLineDelta}
    />
  )
}

/**
 * The turn-end media galleries, the counterpart to hiding a successful
 * generation's tool row (see `isHiddenToolBlock`). Codex keeps its own cards
 * inside `CodexTurnViewPresenter`, so only the Claude path collects here.
 */
function useGeneratedMedia(message: ChatMessage, isCodex: boolean) {
  return useMemo(() => {
    if (isCodex) {
      const items = message.metadata?.codex?.items
      return {
        images: collectCodexGeneratedImages(items),
        videos: collectCodexGeneratedVideos(items),
      }
    }
    const blocks = portableToolBlocks(message.content)
    const results = portableToolResultText(message.content)
    return {
      images: collectGeneratedImages(blocks, results),
      videos: collectGeneratedVideos(blocks, results),
    }
  }, [isCodex, message.content, message.metadata?.codex?.items])
}

export const PortableMessage = memo(function PortableMessage({
  message,
  scheme,
  pendingPermission,
  mentionArtwork = {},
  isLastAssistant = false,
  sessionStreaming = false,
  streamingTokens = ZERO_TURN_TOKENS,
  projectPath = null,
  sourceEnvironmentId = null,
  mcpIcons = {},
  hideCopyActions = false,
  promptKeywords = NO_KEYWORDS,
}: {
  message: ChatMessage
  scheme: 'light' | 'dark'
  pendingPermission: PendingPermission | null
  mentionArtwork?: Record<string, string>
  isLastAssistant?: boolean
  /** The session itself is still producing output (status streaming or background). */
  sessionStreaming?: boolean
  streamingTokens?: TurnTokenCounts
  sourceEnvironmentId?: string | null
  projectPath?: string | null
  mcpIcons?: Record<string, string>
  /** A spoken turn has a synthetic id and nothing to copy or resolve against. */
  hideCopyActions?: boolean
  /** The prompt keywords the session's harness acts on. */
  promptKeywords?: readonly PromptKeyword[]
}) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const isCodex = !isUser && Boolean(message.metadata?.codex)
  const generated = useGeneratedMedia(message, isCodex)
  // A turn's own `status` is not enough: an interrupt or a dropped connection
  // leaves an older turn marked `streaming` forever, and without the session
  // gate the phone spins on it for the rest of the session. Same three-way test
  // the desktop bubble uses.
  const isStreaming = message.status === 'streaming' && sessionStreaming && isLastAssistant
  const collabLabelKey = isUser ? collaborationLabelKey(message) : null
  const isCollaboration = collabLabelKey != null
  // Parent-handed launch task: right-aligned markdown bubble, same as the desktop.
  // Mailbox traffic keeps the left-aligned label + plain-text bubble.
  const isInitialTask = isCollaboration && message.metadata?.collaboration?.kind === 'initial_task'
  const initialTaskText = useMemo(
    () => (isInitialTask
      ? message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
      : ''),
    [isInitialTask, message.content],
  )
  // A sent `/goal …` reads as the objective under a Goal label, same as desktop;
  // a `<realtime_delegation>` envelope reads as the instruction under a Voice label.
  const userText = useMemo(
    () => (isUser ? message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n') : ''),
    [isUser, message.content],
  )
  const goalObjective = isUser ? goalMessageObjective(userText) : null
  // Scanned over the whole sent text: a goal shows its objective without the `/goal` the harness saw.
  const sentKeywords = useMemo(() => promptKeywordsIn(userText, promptKeywords), [userText, promptKeywords])
  const delegation = isUser ? parseRealtimeDelegation(userText) : null
  const fallback = message.metadata?.modelFallback
  const pluginNotice = message.metadata?.pluginNotice
  const body = fallback
    ? (
      <div className="my-1 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs">
        <RefreshCw className="mt-0.5 size-3 shrink-0" />
        <span>
          {fallback.outcome === 'declined' ? 'Model declined' : 'Model switched'}
          {fallback.fromModel ? ` from ${fallback.fromModel}` : ''}
          {fallback.toModel ? ` to ${fallback.toModel}` : ''}
        </span>
      </div>
    )
    : pluginNotice
    ? (
      <div className="my-1 flex items-start gap-2 px-0.5 text-xs text-muted-foreground" role="note">
        {pluginNotice.level === 'error'
          ? <TriangleAlert className="mt-0.5 size-3 shrink-0 text-error" />
          : <Puzzle className="mt-0.5 size-3 shrink-0" />}
        <span className="min-w-0 break-words">
          <span className="font-medium">{pluginNotice.plugin}</span>
          {' '}
          {message.content[0]?.type === 'text' ? message.content[0].text : ''}
        </span>
      </div>
    )
    : delegation
      ? <RealtimeDelegationBody delegation={delegation} />
      : isUser
      ? <UserMessageContentPresenter message={message} text={goalObjective} promptKeywords={sentKeywords} Block={UserToolBlock} />
      : isCodex
        ? <PortableCodexTurn message={message} isStreaming={isStreaming} isLastAssistant={isLastAssistant} />
        : <PortableClaudeTurn message={message} isStreaming={isStreaming} />

  // Copy text is only needed once the turn settles (the button hides while
  // streaming), so skip concatenating the whole turn on every delta.
  const copyText = useMemo(
    () => (isUser || isStreaming || hideCopyActions ? undefined : getAssistantCopyText(message)),
    [isUser, isStreaming, hideCopyActions, message],
  )
  // A collaboration bubble sits on the left, so its menu hugs that edge too;
  // the launch task is the exception and keeps the right edge like user input.
  const userMenu = useUserMessageMenu(message, {
    enabled: isUser && !hideCopyActions && !fallback,
    align: isCollaboration && !isInitialTask ? 'start' : 'end',
  })

  if (isModelOnlyWakeMessage(message)) return null

  return (
    <PortableTurnProvider scheme={scheme} pendingPermission={pendingPermission} projectPath={projectPath} sourceEnvironmentId={sourceEnvironmentId} mcpIcons={mcpIcons}>
      <PortableUserBubblePorts mentionArtwork={mentionArtwork}>
      <article data-turn-id={message.id} data-message-role={message.role} data-message-status={message.status}>
        <ChatMessagePresenter
          isUser={isUser}
          isCollaboration={isCollaboration}
          collaborationLabel={collabLabelKey ? t(collabLabelKey) : undefined}
          goalLabel={goalObjective ? t('chat.goal.label') : undefined}
          voiceLabel={delegation ? t('chat.realtimeVoice.delegation.label') : undefined}
          initialTask={isInitialTask
            ? (
              <PortableCollabTaskBubble
                text={initialTaskText}
                fromTitle={message.metadata?.collaboration?.fromSessionTitle}
                fromSessionId={message.metadata?.collaboration?.fromSessionId}
                scheme={scheme}
                bubbleProps={userMenu.bubbleProps}
                menu={userMenu.menu}
              />
            )
            : undefined}
          body={body}
          userBubbleProps={userMenu.bubbleProps}
          userMenu={userMenu.menu}
          imageGallery={generated.images.length > 0
            ? <PortableImageGallery items={generated.images} />
            : undefined}
          videoGallery={generated.videos.length > 0
            ? <PortableVideoGallery items={generated.videos} />
            : undefined}
          interrupted={message.status === 'interrupted'}
          interruptedLabel={t('chat.interrupted')}
          turnSummary={message.metadata?.turnSummary
            ? <TurnSummaryAboveFooter summary={message.metadata.turnSummary} />
            : undefined}
          assistantFooter={isUser
            ? undefined
            : (
              <PortableTurnFooter
                message={message}
                isStreaming={isStreaming}
                streamingTokens={streamingTokens}
                copyText={copyText}
              />
            )}
          contexts={message.contexts?.length
            ? (
              <MessageContextChips contexts={message.contexts} />
            )
            : undefined}
          sendFailure={isUser && message.metadata?.sendFailure
            ? (
              <SendFailureResendButton
                error={message.metadata.sendFailure.error}
                onResend={() => requestNative('resendFailedMessage', { messageId: message.id })}
              />
            )
            : undefined}
          userActions={message.status === 'interrupted'
            ? <CircleStop className="mt-1 size-3 text-muted-foreground" />
            : undefined}
        />
      </article>
      </PortableUserBubblePorts>
    </PortableTurnProvider>
  )
})
