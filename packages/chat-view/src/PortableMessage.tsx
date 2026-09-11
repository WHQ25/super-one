import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { CircleStop, FileText, ImageIcon, RefreshCw } from 'lucide-react'
import { ChatMessagePresenter } from './presenters/ChatMessage'
import { TurnSummaryAboveFooter } from './presenters/ChatMessageIndicators'
import { collaborationLabelKey } from './presenters/collaboration-label'
import { getAssistantCopyText } from './presenters/getAssistantCopyText'
import { ZERO_TURN_TOKENS, type TurnTokenCounts } from './presenters/turn-footer-model'
import { PortableCollabTaskBubble } from './PortableCollabTaskBubble'
import { PortableUserText } from './PortableUserText'
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
import { previewImage } from './image-preview'
import type { ReductionProjection } from './protocol'
import { useUserMessageMenu } from './use-user-message-menu'

type PendingPermission = NonNullable<ReductionProjection['pendingPermission']>

/**
 * Same copy the desktop bubble carries. It is a literal on both surfaces
 * because it is not translated there either — parity here means the same
 * string, not a new key only the phone would use.
 */
const INTERRUPTED_LABEL = 'Interrupted · What should I do instead?'

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

function PortableUserContent({
  message,
  mentionArtwork,
}: {
  message: ChatMessage
  mentionArtwork: Record<string, string>
}) {
  const results = resultsByTool(message.content)
  return message.content.map((block, index) => {
    if (block.type === 'text') {
      return <PortableUserText key={index} text={block.text} mentionArtwork={mentionArtwork} />
    }
    if (block.type === 'image') {
      return (
        <div key={index} className="my-1 flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1 text-xs">
          <ImageIcon className="size-3" /> {block.name}
        </div>
      )
    }
    if (block.type === 'document') {
      return (
        <div key={index} className="my-1 flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1 text-xs">
          <FileText className="size-3" /> {block.name}
        </div>
      )
    }
    if ('toolName' in block && 'toolUseId' in block && 'input' in block) {
      const result = results.get(block.toolUseId)
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
    return null
  })
}

function AttachmentGallery({ message }: { message: ChatMessage }) {
  if (!message.attachments?.length) return null
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {message.attachments.map((attachment, index) => {
        const src = `data:${attachment.mimeType};base64,${attachment.base64}`
        const picture = <img src={src} alt={attachment.name} className="max-h-64 w-full rounded-lg object-contain" />
        // Only a real picture opens the viewer; a PDF attachment has no bitmap to show.
        if (!attachment.mimeType.startsWith('image/')) return <div key={attachment.id ?? index}>{picture}</div>
        return (
          <button
            key={attachment.id ?? index}
            type="button"
            className="block w-full overflow-hidden rounded-lg"
            onClick={() => previewImage(src, { label: attachment.name })}
            aria-label={`Preview ${attachment.name}`}
          >
            {picture}
          </button>
        )
      })}
    </div>
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
  mcpIcons = {},
  hideCopyActions = false,
}: {
  message: ChatMessage
  scheme: 'light' | 'dark'
  pendingPermission: PendingPermission | null
  mentionArtwork?: Record<string, string>
  isLastAssistant?: boolean
  /** The session itself is still producing output (status streaming or background). */
  sessionStreaming?: boolean
  streamingTokens?: TurnTokenCounts
  projectPath?: string | null
  mcpIcons?: Record<string, string>
  /** A spoken turn has a synthetic id and nothing to copy or resolve against. */
  hideCopyActions?: boolean
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
  const fallback = message.metadata?.modelFallback
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
    : isUser
      ? <PortableUserContent message={message} mentionArtwork={mentionArtwork} />
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

  return (
    <PortableTurnProvider scheme={scheme} pendingPermission={pendingPermission} projectPath={projectPath} mcpIcons={mcpIcons}>
      <article data-turn-id={message.id} data-message-role={message.role} data-message-status={message.status}>
        <ChatMessagePresenter
          isUser={isUser}
          isCollaboration={isCollaboration}
          collaborationLabel={collabLabelKey ? t(collabLabelKey) : undefined}
          initialTask={isInitialTask
            ? (
              <PortableCollabTaskBubble
                text={initialTaskText}
                scheme={scheme}
                bubbleProps={userMenu.bubbleProps}
                menu={userMenu.menu}
              />
            )
            : undefined}
          body={body}
          userBubbleProps={userMenu.bubbleProps}
          userMenu={userMenu.menu}
          imageGallery={
            <>
              <AttachmentGallery message={message} />
              {generated.images.length > 0 && <PortableImageGallery items={generated.images} />}
            </>
          }
          videoGallery={generated.videos.length > 0
            ? <PortableVideoGallery items={generated.videos} />
            : undefined}
          interrupted={message.status === 'interrupted'}
          interruptedLabel={INTERRUPTED_LABEL}
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
              <div className="space-y-1 text-xs text-muted-foreground">
                {message.contexts.map((context) => <div key={`${context.appId}-${context.summary}`}>{context.appName}: {context.summary}</div>)}
              </div>
            )
            : undefined}
          userActions={message.status === 'interrupted'
            ? <CircleStop className="mt-1 size-3 text-muted-foreground" />
            : undefined}
        />
      </article>
    </PortableTurnProvider>
  )
})
