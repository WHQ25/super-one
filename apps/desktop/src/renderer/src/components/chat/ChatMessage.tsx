import type { ChatMessage as ChatMessageType, ContentBlock, AgentStatus, ImageGenerationItem, VideoGenerationItem, ImageAttachment } from '@superone/shared/agent-types'
import { useState, useEffect, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { FileText, Folder } from 'lucide-react'
import { ToolBlock } from './ToolBlock'
import { ToolGroup } from './ToolGroup'
import { AppToolGroup } from './AppToolGroup'
import { parseToolInput, isHiddenToolBlock } from './tool-display'
import {
  isClaudePinnedSegment,
} from './compact-chat-mode'
import { summarizeClaudeProcess } from './turn-process-stats'
import { TurnDetailSection } from './TurnDetailSection'
import { toImageGenerationItems, toVideoStatusItems, isMediaGenerateImageTool, isMediaVideoStatusTool, isGrokVideoGenTool, isWidgetShowTool, nativeWidgetImages, nativeWidgetVideos, collectCodexGeneratedImages, collectCodexGeneratedVideos } from './media-generation'
import { useMiniAppStore } from '@/stores/miniapp'
import { SubagentBlock } from './SubagentBlock'
import { WorkflowBlock } from './WorkflowBlock'
import { CodexTurnView } from './CodexTurnView'
import { ImageGalleryBlock } from './ImageGalleryBlock'
import { VideoGalleryBlock } from './VideoGalleryBlock'
import { AttachmentChip, AttachmentPreviewDialog } from './attachment-chip'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { UserSelectionChip } from './UserSelectionChip'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { MentionChipContent, isBlendedMentionKind, mentionChipIcon } from './MentionChip'
import { PasteChipPreview } from './PasteChipPreview'
import { PASTE_CHIP_LINE_THRESHOLD, PASTE_CHIP_CHAR_THRESHOLD } from './paste-chip-node'
import { useChatStore } from '@/stores/chat'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { getAssistantCopyText } from './chat-message/getAssistantCopyText'
import { resolveMarkdownLocalRefs } from './chat-shared'
import { RewindButton } from './RewindButton'
import { CopyableMarkdown } from './CopyableMarkdown'
import { CollabTaskBubble } from './CollabTaskBubble'
import { CopyButton, useCopyText } from './chat-message/copy-button'
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

// Own component so the media-resolution regex is scoped to this block (memoized on text +
// projectPath by the React Compiler): a completed text block no longer re-runs the scan when a
// later block in the same streaming message mutates.
function TextBlock({ text, isStreaming, projectPath, afterThinking }: {
  text: string
  isStreaming: boolean
  projectPath?: string | null
  afterThinking?: boolean
}) {
  const resolved = projectPath ? resolveMarkdownLocalRefs(text, projectPath) : text
  return (
    <div className={afterThinking ? 'mt-1 after-thinking' : undefined}>
      <CopyableMarkdown text={resolved} isStreaming={isStreaming} components={fileLinkComponents} />
    </div>
  )
}

function DesktopDocumentIcon({ name }: ClaudeDocumentPresenterProps) {
  return <FileIcon name={name} size={14} />
}

const CLAUDE_TURN_PARTS: ClaudeTurnBodyPresenterParts = {
  Text: TextBlock,
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

function LongTextChip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lineCount = text.split('\n').length
  const preview = text.slice(0, 60).replace(/\n/g, ' ')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex w-full items-center gap-2 rounded-lg border border-foreground/15 bg-foreground/5 px-3 py-2 text-left text-xs text-foreground/80 transition-colors hover:bg-foreground/10"
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{preview}</span>
        <span className="ml-auto shrink-0 text-foreground/50">{lineCount} lines</span>
      </button>
      <PasteChipPreview open={open} onOpenChange={setOpen} text={text} />
    </>
  )
}

function RestContent({ rest, forcePlain }: { rest: string; forcePlain?: boolean }) {
  if (forcePlain) return <span className="user-text-rest">{rest}</span>
  const lineCount = rest.split('\n').length
  if (lineCount >= PASTE_CHIP_LINE_THRESHOLD || rest.length >= PASTE_CHIP_CHAR_THRESHOLD) return <LongTextChip text={rest} />
  return <span className="user-text-rest">{rest}</span>
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

  const isBlendedChip = isBlendedMentionKind(resolvedKind)
  const display =
    resolvedKind === 'miniapp' || isBlendedChip
      ? (displayName || value)
      : (value.replace(/\/$/, '').split('/').pop() || value)

  if (resolvedKind === 'agent') {
    return (
      <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap break-normal rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-xs leading-5 text-primary">
        <span className="font-medium">@{display}</span>
      </span>
    )
  }

  // Same .mention-chip* CSS as composer — em-only, scales with Cmd+= zoom.
  // break-normal resists the bubble's break-all so multi-word labels stay one line.
  return (
    <MentionChipContent
      blended={isBlendedChip}
      kind={resolvedKind}
      className="break-normal"
      icon={
        resolvedKind === 'directory'
          ? <Folder className="text-primary" />
          : mentionChipIcon(resolvedKind, value, display)
      }
      label={display}
    />
  )
}

export function UserTextBlock({ text, isPaste }: { text: string; isPaste?: boolean }) {
  if (isPaste === true) return <LongTextChip text={text} />
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
        <MessageContextChipItem key={ctx.appId} ctx={ctx} />
      ))}
    </div>
  )
}

function collectGeneratedImages(content: ContentBlock[], toolResultMap: Map<string, string>): ImageGenerationItem[] {
  const items: ImageGenerationItem[] = []
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    // A native-template widget_show hands the gallery items the host already prepared, so an
    // agent-written provider adapter lands in the same surface as a built-in generation.
    if (isWidgetShowTool(block.toolName)) {
      items.push(...nativeWidgetImages(toolResultMap.get(block.toolUseId)))
      continue
    }
    if (!isMediaGenerateImageTool(block.toolName)) continue
    items.push(...toImageGenerationItems(
      block.toolUseId,
      parseToolInput(block.input, block.toolName),
      toolResultMap.get(block.toolUseId),
    ))
  }
  return items
}

/**
 * Collect the finished video cards for a turn.
 *
 * Only the completing status poll produces a card. A generation spans two tool calls and the poll
 * usually lands in a later message than the submit, so a placeholder emitted at submit time would
 * be stranded in an earlier message with no way to ever settle — the visible submit tool block is
 * the progress affordance instead.
 */
function collectGeneratedVideos(content: ContentBlock[], toolResultMap: Map<string, string>): VideoGenerationItem[] {
  const byId = new Map<string, VideoGenerationItem>()
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    const result = toolResultMap.get(block.toolUseId)
    if (isWidgetShowTool(block.toolName)) {
      for (const item of nativeWidgetVideos(result)) byId.set(item.id, item)
      continue
    }
    // SuperOne async poll, or Grok native video tools that return a finished path.
    if (!isMediaVideoStatusTool(block.toolName) && !isGrokVideoGenTool(block.toolName)) continue
    for (const item of toVideoStatusItems(result)) byId.set(item.id, item)
  }
  return [...byId.values()]
}

function collaborationLabelKey(message: ChatMessageType): string | null {
  const source = message.metadata?.source
  if (source === 'task-notification') return 'chat.collaboration.taskNotification'
  if (source !== 'collaboration') return null
  const collab = message.metadata?.collaboration
  if (collab?.kind === 'initial_task') return 'chat.collaboration.initialTask'
  if (collab?.direction === 'outbound') return 'chat.collaboration.toAgent'
  return 'chat.collaboration.fromAgent'
}

/** Host wake for session_collab mailbox — agent sees full prompt; UI shows a compact inbox row. */
function isCollabMailboxWakeText(text: string): boolean {
  // Prefer the host template phrase; tool names alone must not hide normal user questions.
  return /collaboration mailbox message is ready/i.test(text)
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
  // Require task-notification provenance so asking about session_collab_* tools
  // in a normal user bubble is never rewritten as a mailbox row.
  const isMailboxWake = isUser
    && message.metadata?.source === 'task-notification'
    && isCollabMailboxWakeText(
      message.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n'),
    )
  // Copy text is only needed once the turn settles (the copy button is hidden while streaming),
  // so skip deriving the full concatenated text on every delta of the live message.
  const assistantCopyText = isStreaming || hideCopyActions ? undefined : getAssistantCopyText(message)

  const apps = useMiniAppStore((s) => s.apps)
  const [previewAtt, setPreviewAtt] = useState<ImageAttachment | null>(null)
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
  const { copied: userCopied, copy: copyUserText } = useCopyText()
  const assistantFooter = !isUser ? (
    <DurationFooter
      message={message}
      copyText={assistantCopyText}
      parentIsStreaming={isStreaming}
      className={message.metadata?.turnSummary ? 'mt-1' : undefined}
    />
  ) : null
  const body = isUser ? (
    <TooltipProvider delayDuration={200}>
      {message.userSelections && message.userSelections.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          <UserSelectionChip selections={message.userSelections} readOnly />
        </div>
      )}
      {message.content.map((block, index) => {
        if (block.type === 'image' || block.type === 'document') {
          const attachment = message.attachments?.find((item) => (
            block.id ? item.id === block.id : item.name === block.name
          ))
          return attachment
            ? <AttachmentChip key={index} att={attachment} onOpen={() => setPreviewAtt(attachment)} />
            : null
        }
        return block.type === 'text'
          ? <UserTextBlock key={index} text={block.text} isPaste={block.isPaste} />
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
      <AttachmentPreviewDialog attachment={previewAtt} onClose={() => setPreviewAtt(null)} />
    </TooltipProvider>
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
    <ClaudeTurnBodyPresenter
      grouped={grouped!}
      isStreaming={isStreaming}
      detailChatMode={detailChatMode}
      projectPath={projectPath}
      parts={CLAUDE_TURN_PARTS}
      runtime={CLAUDE_TURN_RUNTIME}
    />
  )
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
      {userText.length > 0 && (
        <CopyButton
          copied={userCopied}
          onClick={() => copyUserText(userText)}
          className="opacity-100"
        />
      )}
    </div>
  ) : undefined

  return (
    <ChatMessagePresenter
      isUser={isUser}
      isCollaboration={isCollab}
      collaborationLabel={collabLabelKey ? t(collabLabelKey) : undefined}
      mailboxLabel={isMailboxWake ? t('chat.collaboration.mailboxReady') : undefined}
      initialTask={isInitialTask ? <CollabTaskBubble text={userText} /> : undefined}
      body={body}
      imageGallery={generatedImages.length > 0
        ? <ImageGalleryBlock items={generatedImages} />
        : undefined}
      videoGallery={generatedVideos.length > 0
        ? <VideoGalleryBlock items={generatedVideos} />
        : undefined}
      interrupted={message.status === 'interrupted'}
      interruptedLabel="Interrupted · What should I do instead?"
      turnSummary={message.metadata?.turnSummary
        ? <TurnSummaryAboveFooter summary={message.metadata.turnSummary} />
        : undefined}
      assistantFooter={assistantFooter}
      footerInsideBody={!!collapseEntireCodexTurn}
      contexts={message.contexts && message.contexts.length > 0
        ? <MessageContextChips contexts={message.contexts} />
        : undefined}
      userActions={userActions}
    />
  )
})
