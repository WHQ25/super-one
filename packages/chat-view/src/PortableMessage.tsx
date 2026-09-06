import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { AlertTriangle, Bot, CircleStop, FileText, ImageIcon, RefreshCw } from 'lucide-react'
import { ChatMessagePresenter } from './presenters/ChatMessage'
import { PortableUserText } from './PortableUserText'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableToolRow } from './PortableToolRow'
import {
  PortableClaudeTurn,
  PortableCodexTurn,
  PortableTurnProvider,
} from './PortableTurnAdapters'
import type { ReductionProjection } from './protocol'

type PendingPermission = NonNullable<ReductionProjection['pendingPermission']>

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
  scheme,
  pendingPermission,
  mentionArtwork,
}: {
  message: ChatMessage
  scheme: 'light' | 'dark'
  pendingPermission: PendingPermission | null
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
      {message.attachments.map((attachment, index) => (
        <img
          key={attachment.id ?? index}
          src={`data:${attachment.mimeType};base64,${attachment.base64}`}
          alt={attachment.name}
          className="max-h-64 w-full rounded-lg object-contain"
        />
      ))}
    </div>
  )
}

export function PortableMessage({
  message,
  scheme,
  pendingPermission,
  mentionArtwork = {},
  isLastAssistant = false,
}: {
  message: ChatMessage
  scheme: 'light' | 'dark'
  pendingPermission: PendingPermission | null
  mentionArtwork?: Record<string, string>
  isLastAssistant?: boolean
}) {
  const isUser = message.role === 'user'
  const isCollaboration = message.metadata?.source === 'collaboration'
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
      ? <PortableUserContent message={message} scheme={scheme} pendingPermission={pendingPermission} mentionArtwork={mentionArtwork} />
      : message.metadata?.codex
        ? <PortableCodexTurn message={message} isLastAssistant={isLastAssistant} />
        : <PortableClaudeTurn message={message} />

  const errorFooter = message.metadata?.errorInfo
    ? (
      <div className="mt-2 flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        <span>{message.metadata.errorInfo.raw}</span>
      </div>
    )
    : message.status === 'streaming'
      ? <div className="mt-1 flex items-center gap-1 text-xs text-primary"><Bot className="size-3 animate-pulse" /> Working…</div>
      : undefined

  return (
    <PortableTurnProvider scheme={scheme} pendingPermission={pendingPermission}>
      <article data-turn-id={message.id} data-message-status={message.status}>
        <ChatMessagePresenter
          isUser={isUser}
          isCollaboration={isCollaboration}
          collaborationLabel={isCollaboration ? 'Collaboration' : undefined}
          body={body}
          imageGallery={<AttachmentGallery message={message} />}
          interrupted={message.status === 'interrupted'}
          interruptedLabel="Interrupted"
          turnSummary={message.metadata?.turnSummary
            ? <div className="mt-2 text-xs text-muted-foreground">{message.metadata.turnSummary}</div>
            : undefined}
          assistantFooter={errorFooter}
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
}
