import { forwardRef, type ComponentProps, type ReactNode, type Ref } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'

/** The session row. HoverCard's trigger is also its anchor, so this element
 *  has to be the row: the card then shares the row's top edge and starts to
 *  its right. The context menu slots its handlers onto this component; they
 *  have to reach the row or a right-click does nothing. */
type SessionHoverTriggerProps = ComponentProps<typeof HoverCardTrigger> & {
  /** Context-menu trigger stamps this. Dropped so the hover-card marker stays. */
  'data-slot'?: string
}

export const SessionHoverCardTrigger = forwardRef<HTMLElement, SessionHoverTriggerProps>(
  function SessionHoverCardTrigger({ children, ...props }, ref) {
    // Both triggers stamp `data-slot`. Keep the hover-card marker; the menu
    // opens from `onContextMenu`, not from its slot name.
    const { 'data-slot': _dataSlot, ...rest } = props
    return (
      // Radix types the trigger ref as an anchor. `asChild` forwards it to the row.
      <HoverCardTrigger asChild {...rest} ref={ref as Ref<HTMLAnchorElement>}>
        {children}
      </HoverCardTrigger>
    )
  },
)

/** Same placement for every sidebar hover card: 4px to the right of the row, top-aligned. */
export function SidebarHoverCard({
  open,
  onOpenChange,
  children,
  content,
}: {
  /** Stories pin the card open. Production leaves this unset. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Usually the context menu, with `SessionHoverCardTrigger` on the row inside it. */
  children: ReactNode
  content: ReactNode
}) {
  return (
    <HoverCard open={open} onOpenChange={onOpenChange} openDelay={300} closeDelay={150}>
      {children}
      {/* 4px off the row. Flush looks stuck to the title; a collision shift
          would slide the card left onto it. */}
      <HoverCardContent
        className="w-72 p-3"
        side="right"
        align="start"
        sideOffset={4}
        avoidCollisions={false}
      >
        {content}
      </HoverCardContent>
    </HoverCard>
  )
}
