import type { ReactNode } from 'react'
import { Bot, Inbox, OctagonX } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export interface ChatMessagePresenterProps {
  isUser: boolean
  isCollaboration: boolean
  collaborationLabel?: string
  mailboxLabel?: string
  initialTask?: ReactNode
  body: ReactNode
  imageGallery?: ReactNode
  videoGallery?: ReactNode
  interrupted: boolean
  interruptedLabel: string
  turnSummary?: ReactNode
  assistantFooter?: ReactNode
  footerInsideBody?: boolean
  contexts?: ReactNode
  userActions?: ReactNode
}

/** Host-agnostic message layout; all store, filesystem and interaction nodes are ports. */
export function ChatMessagePresenter({
  isUser,
  isCollaboration,
  collaborationLabel,
  mailboxLabel,
  initialTask,
  body,
  imageGallery,
  videoGallery,
  interrupted,
  interruptedLabel,
  turnSummary,
  assistantFooter,
  footerInsideBody = false,
  contexts,
  userActions,
}: ChatMessagePresenterProps) {
  if (mailboxLabel) {
    return (
      <div className="mb-0.5 flex w-0 min-w-full justify-end">
        <div className="flex max-w-[90%] items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <Inbox className="size-3 shrink-0 opacity-80" />
          <span className="shrink-0">{mailboxLabel}</span>
        </div>
      </div>
    )
  }

  if (initialTask) return initialTask

  return (
    <div className={cn(
      'w-0 min-w-full flex',
      isUser
        ? isCollaboration ? 'justify-start' : 'justify-end'
        : 'mb-2 justify-start',
    )}>
      <div className={cn(
        isUser
          ? 'group/copy relative mb-0 flex min-w-0 max-w-[90%] flex-col'
          : 'w-full',
        isUser && !isCollaboration && 'items-end',
        isUser && isCollaboration && 'items-start',
      )}>
        {isCollaboration && collaborationLabel && (
          <div className="mb-1 flex items-center gap-1 px-0.5 text-xs font-medium text-primary/80">
            <Bot className="size-3 shrink-0" />
            <span>{collaborationLabel}</span>
          </div>
        )}
        <div className={cn(
          'min-w-0 text-sm',
          isUser
            ? cn(
                'max-w-full overflow-hidden rounded-xl px-3 py-2 text-foreground break-all',
                isCollaboration
                  ? 'border border-primary/25 bg-primary/5'
                  : 'bg-muted/80',
              )
            : 'assistant-reply w-full text-foreground',
        )}>
          {body}
          {!isUser && imageGallery}
          {!isUser && videoGallery}
          {interrupted && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <OctagonX className="size-3" />
              <span>{interruptedLabel}</span>
            </div>
          )}
          {!isUser && turnSummary}
          {!footerInsideBody && assistantFooter}
        </div>
        {isUser && contexts && <div className="mt-1.5">{contexts}</div>}
        {isUser && userActions}
      </div>
    </div>
  )
}
