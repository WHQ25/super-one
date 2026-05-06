import { Bot, Check } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export const COLLAPSED_SIZE = 48
export const COLLAPSED_PENDING_MAX_W = 320

interface CollapsedChatPanelViewProps {
  pendingReason: string | null
  isRunning: boolean
  isUnseen: boolean
  isDragging?: boolean
  onClick?: (e: React.MouseEvent) => void
  onMouseDown?: (e: React.MouseEvent) => void
}

export function CollapsedChatPanelView({
  pendingReason,
  isRunning,
  isUnseen,
  isDragging = false,
  onClick,
  onMouseDown,
}: CollapsedChatPanelViewProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full shrink-0 select-none items-center bg-card transition-colors',
        pendingReason ? 'cursor-pointer gap-2 px-3 hover:bg-muted/40' : 'cursor-pointer justify-center hover:bg-muted/40',
        isDragging && 'cursor-grabbing'
      )}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      {isUnseen ? (
        <Check className="size-5 shrink-0 text-green-600 dark:text-green-400" />
      ) : (
        <Bot className={cn('size-5 shrink-0 text-foreground/80', isRunning && 'animate-pulse')} />
      )}
      {pendingReason && (
        <span className="min-w-0 truncate text-left text-xs text-foreground/80">
          {pendingReason}
        </span>
      )}
    </div>
  )
}
