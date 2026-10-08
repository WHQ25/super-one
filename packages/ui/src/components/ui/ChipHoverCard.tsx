import type { ReactNode } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card'

/**
 * Hover card shared by chat chips (composer and sent bubble): a header with the
 * chip's title and extra actions, then a fuller preview. Chips carry no inline
 * buttons — Backspace removes them in the composer — so anything beyond click
 * lives here.
 */
export function ChipHoverCard({ children, onOpen, title, actions, card, open, onOpenChange }: {
  children: ReactNode
  onOpen?: () => void
  title?: ReactNode
  actions?: ReactNode
  card?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <HoverCard open={open} openDelay={250} closeDelay={80} onOpenChange={(open) => { onOpenChange?.(open); if (open) onOpen?.() }}>
      <HoverCardTrigger asChild>
        <span className="cursor-inherit">{children}</span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[min(28rem,80vw)] space-y-2 p-3 text-xs">
        {(title || actions) && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate font-medium">{title}</div>
            {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
          </div>
        )}
        {card}
      </HoverCardContent>
    </HoverCard>
  )
}
