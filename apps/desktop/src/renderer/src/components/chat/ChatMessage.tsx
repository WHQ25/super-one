import type { ChatMessage as ChatMessageType, AgentStatus, ImageGenerationItem, VideoGenerationItem } from '@superone/shared/agent-types'
import { ModMessageScope, ModSite, stringProp, userMessageProps } from '@superone/chat-view/mod-ui'
import { useState, useEffect, useMemo, memo } from 'react'
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
import { AttachmentChip } from './attachment-chip'
import { ContextAttachments } from '@superone/ui/components/ui/context-attachments'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { UserSelectionChip } from './UserSelectionChip'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MentionChipContent, isLabelMentionKind, mentionChipIcon, useFileMentionActions } from './MentionChip'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { hasTextSelection } from '@/lib/file-link'
import { McpMentionSentHover } from './McpMentionSent'
import { McpMentionSentProvider } from '@superone/chat-view/presenters/McpMentionCard'
import { PasteChip } from './paste-chip'
import { isLongPaste } from './paste-chip-node'
import { getActiveSessionView, useChatStore, useSessionScope } from '@/stores/chat'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { getAssistantCopyText } from './chat-message/getAssistantCopyText'
import { resolveMarkdownFileLinks } from './chat-shared'
import { RewindButton } from './RewindButton'
import { SendFailureResendButton } from '@superone/chat-view/presenters/SendFailureResendButton'
import { CopyableMarkdown, InsightBlock } from './CopyableMarkdown'
import { CollabTaskBubble } from './CollabTaskBubble'
import { CopyButton, useCopyFeedback } from './chat-message/copy-button'
import { mentionCopyText, userCopyHtml } from './chat-message/user-copy-html'
import { attachmentForBlock, userMessageParts } from './chat-message/user-message-parts'
import { tryCopy, tryCopyRich, type CopiedMention } from '@/lib/clipboard'
import { fileLinkComponents } from './chat-markdown-components'
import { ReasoningBlock } from './ReasoningBlock'
import { parseUserMentions, type UserMentionKind } from './user-mention-parser'
import { replaceMiniAppTagsWithMention } from '@superone/shared/miniapp-prompt-tags'
import { deriveColors, ContextPreviewContent } from './ContextChip'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useIsDark } from '@/hooks/use-is-dark'
import type { ChatMessageContext } from '@superone/shared/agent-types'
import { TurnSummaryAboveFooter } from './presenters/ChatMessageIndicators'
import { DurationFooter } from './ChatMessageFooter'
import { collaborationLabelKey, isModelOnlyWakeMessage } from '@superone/chat-view/presenters/collaboration-label'
import { goalMessageObjective } from '@superone/shared/session-goal'
import { parseRealtimeDelegation } from '@superone/shared/realtime-timeline'
import { RealtimeDelegationBody } from '@superone/chat-view/presenters/RealtimeDelegationBody'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { ChatMessagePresenter } from './presenters/ChatMessage'
import {
  ClaudeBlockPresenter,
  ClaudeTurnBodyPresenter,
  type ClaudeDocumentPresenterProps,
  type ClaudeTurnBodyPresenterParts,
  type ClaudeTurnBodyPresenterRuntime,
} from './presenters/ClaudeTurnBody'
import {
  groupContent,
} from './chat-message/groupContent'

export { groupContent }
export * from './presenters/ChatMessageIndicators'

interface ChatMessageProps {
  message: ChatMessageType
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

function DesktopDocumentIcon({ name }: ClaudeDocumentPresenterProps) {
  return <FileIcon name={name} size={14} />
}

const CLAUDE_TURN_PARTS: ClaudeTurnBodyPresenterParts = {
  Text: TextBlock,
  Insight: InsightBlock,
  Document: DesktopDocumentIcon,
  Tool: ToolBlock,
  Reasoning: ReasoningBlock,
  Subagent: SubagentBlock,
  Workflow: WorkflowBlock,
  ToolGroup,
  AppToolGroup,
  TurnDetail: TurnDetailSection,
}

const CLAUDE_TURN_RUNTIME: ClaudeTurnBodyPresenterRuntime = {
  isBackgroundTool(block) {
    if (block.toolName !== 'Bash') return false
    const params = parseToolInput(block.input, block.toolName)
    return params.run_in_background === true || params.background === true
  },
  isPinnedSegment: isClaudePinnedSegment,
  isHiddenTool: isHiddenToolBlock,
  summarizeProcess: summarizeClaudeProcess,
}

function RestContent({ rest, forcePlain }: { rest: string; forcePlain?: boolean }) {
  if (forcePlain) return <span className="user-text-rest">{rest}</span>
  if (isLongPaste(rest)) return <PasteChip text={rest} selectable />
  return <span className="user-text-rest">{rest}</span>
}

/** A bubble mention copies as its `@` text, and pastes back into the composer as the chip. */
function mentionCopyProps(mention: CopiedMention) {
  return { 'data-copy-text': mentionCopyText(mention), 'data-copy-mention': JSON.stringify(mention) }
}

function FileMentionInlineChip({ value, label }: { value: string; label: string }) {
  const { menu, chipProps, iconProps } = useFileMentionActions(value, label)
  return (
    <AdaptiveContextMenu items={menu.items} onOpen={menu.onOpen} yieldWhen={hasTextSelection}>
      <MentionChipContent
        {...chipProps}
        kind="file"
        // Like FileChip: the name stays selectable text; only the icon drags the file.
        className="break-normal cursor-pointer select-text"
        {...mentionCopyProps({ kind: 'file', value, displayName: label })}
        icon={mentionChipIcon('file', value, label)}
        label={label}
        iconProps={iconProps}
      />
    </AdaptiveContextMenu>
  )
}

function MentionInlineChip({ kind, value, displayName }: { kind: UserMentionKind; value: string; displayName?: string }) {
  // Mentions re-parsed from plain text only know directory via trailing `/`.
  // Older inserts (and some drop paths) lost that marker and rendered folders
  // as files. Stat extensionless file mentions once so real directories recover.
  const [resolvedKind, setResolvedKind] = useState<UserMentionKind>(kind)
  useEffect(() => {
    setResolvedKind(kind)
    if (kind !== 'file') return
    const bare = value.replace(/\/$/, '')
    const baseName = bare.split(/[/\\]/).pop() || bare
    if (!bare || baseName.includes('.')) return
    let cancelled = false
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const abs = bare.startsWith('/') ? bare : projectRoot ? `${projectRoot}/${bare}` : null
    if (!abs) return
    void window.app.pathStat(abs).then((stat) => {
      if (!cancelled && stat?.isDirectory) setResolvedKind('directory')
    })
    return () => { cancelled = true }
  }, [kind, value])

  const display =
    resolvedKind === 'miniapp' || isLabelMentionKind(resolvedKind)
      ? (displayName || value)
      : (value.replace(/\/$/, '').split('/').pop() || value)

  if (resolvedKind === 'file') return <FileMentionInlineChip value={value} label={display} />

  // Same .mention-chip* CSS as composer — em-only, scales with Cmd+= zoom.
  // break-normal resists the bubble's break-all so labels wrap between words.
  const chip = (
    <MentionChipContent
      kind={resolvedKind}
      className="break-normal select-text"
      {...mentionCopyProps({ kind: resolvedKind, value, displayName: display })}
      icon={mentionChipIcon(resolvedKind, value, display)}
      label={display}
    />
  )
  return resolvedKind === 'mcp-resource' ? <McpMentionSentHover value={value}>{chip}</McpMentionSentHover> : chip
}

export function UserTextBlock({ text, isPaste }: { text: string; isPaste?: boolean }) {
  if (isPaste === true) return <PasteChip text={text} selectable />
  const segments = parseUserMentions(text)
  if (segments.length === 0) return null
  // Normal inline flow (see .user-text-with-mentions). Chip is display:inline
  // so its label owns the baseline; long rest text wraps beside the chip.
  return (
    <span className="user-text-with-mentions">
      {segments.map((seg, i) =>
        seg.type === 'mention'
          ? <MentionInlineChip key={i} kind={seg.kind} value={seg.value} displayName={seg.displayName} />
          : <RestContent key={i} rest={seg.text} forcePlain={isPaste === false} />
      )}
    </span>
  )
}

function MessageContextChipItem({ ctx }: { ctx: ChatMessageContext }) {
  const [open, setOpen] = useState(false)
  const isDark = useIsDark()
  const colors = deriveColors(ctx.color, isDark)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap cursor-pointer"
          style={{ background: `${colors.bg}cc`, border: `1px solid ${colors.bg}` }}
          onClick={() => setOpen(!open)}
        >
          <MiniAppIcon appId={ctx.appId} className="size-3 shrink-0" />
          <span style={{ color: colors.color }} className="font-medium">{ctx.appName}</span>
          {ctx.summary && (
            <>
              <span style={{ color: colors.labelColor, fontSize: 10 }}>·</span>
              <span style={{ color: colors.labelColor, fontSize: 11 }}>{ctx.summary}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-80 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ContextPreviewContent appName={ctx.appName} summary={ctx.summary} content={ctx.content} />
      </PopoverContent>
    </Popover>
  )
}

function MessageContextChips({ contexts }: { contexts: ChatMessageContext[] }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {contexts.map((ctx) => (
        ctx.appId.startsWith('mcp:')
          ? <ContextAttachments key={ctx.appId} items={[{ id: ctx.appId, title: ctx.summary, source: ctx.appName, content: ctx.content, thumbnail: ctx.thumbnail }]} />
          : <MessageContextChipItem key={ctx.appId} ctx={ctx} />
      ))}
    </div>
  )
}


export const ChatMessage = memo(function ChatMessage({
  message,
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
  const assistantCopyText = isStreaming || hideCopyActions ? undefined : getAssistantCopyText(message)

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
  const goalObjective = isUser ? goalMessageObjective(userText) : null
  // A `<realtime_delegation>` envelope is what the voice agent asked Codex to do:
  // an ordinary user bubble under a Voice label, linking back to the spoken turn.
  const delegation = isUser ? parseRealtimeDelegation(userText) : null
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
  const copyUserMessage = () => runUserCopy(() => (hasUserChips
    ? tryCopyRich(userText, userCopyHtml(userCopyParts))
    : tryCopy(userText)))
  const assistantFooter = !isUser ? (
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
    <McpMentionSentProvider content={message.content}>
      <TooltipProvider delayDuration={200}>
        {message.userSelections && message.userSelections.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            <UserSelectionChip selections={message.userSelections} readOnly />
          </div>
        )}
        {message.content.map((block, index) => {
          if (block.type === 'image' || block.type === 'document') {
            const attachment = attachmentForBlock(message, block)
            return attachment
              ? <AttachmentChip key={index} att={attachment} selectable />
              : null
          }
          return block.type === 'text'
            ? (
              <ModSite key={index} component="UserMessage" instanceId={index === 0 ? message.id : `${message.id}:${index}`} props={userMessageProps(goalObjective ?? block.text)}>
                {(p) => <UserTextBlock text={stringProp(p, 'text', goalObjective ?? block.text)} isPaste={block.isPaste} />}
              </ModSite>
            )
            : (
              <ClaudeBlockPresenter
                key={index}
                block={block}
                index={index}
                isStreaming={false}
                parts={CLAUDE_TURN_PARTS}
                runtime={CLAUDE_TURN_RUNTIME}
              />
            )
        })}
      </TooltipProvider>
    </McpMentionSentProvider>
  ) : isCodexMessage ? (
    <CodexTurnView
      message={message}
      isStreaming={isStreaming}
      isWorking={isWorking}
      isLastAssistant={isLastAssistant}
      collapseEntireTurn={collapseEntireCodexTurn}
      footer={collapseEntireCodexTurn ? assistantFooter : undefined}
    />
  ) : (
    <ModMessageScope messageId={message.id}>
      <ClaudeTurnBodyPresenter
        grouped={grouped!}
        isStreaming={isStreaming}
        detailChatMode={detailChatMode}
        projectPath={projectPath}
        parts={CLAUDE_TURN_PARTS}
        runtime={CLAUDE_TURN_RUNTIME}
      />
    </ModMessageScope>
  )
  const sendFailure = isUser ? message.metadata?.sendFailure : undefined
  const userActions = isUser && !hideCopyActions && (
    (!isCollab && !hideUserActions) || (isCollab && userText.length > 0)
  ) ? (
    <div className="relative mt-1 flex items-center gap-1 opacity-0 group-hover/copy:opacity-100">
      {!isCollab && message.checkpointId && (
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

  if (isModelOnlyWakeMessage(message)) return null

  return (
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
      turnSummary={message.metadata?.turnSummary
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
            onResend={() => { void useChatStore.getState().resendFailedMessage(message.id) }}
          />
        )
        : undefined}
      userActions={userActions}
    />
  )
})
