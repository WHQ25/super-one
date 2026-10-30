import { cloneElement, createContext, forwardRef, isValidElement, useContext, useState, type ComponentProps, type ReactElement, type ReactNode, type Ref } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'

/** True while this sidebar hover card is open. Default false outside a card. */
const SidebarHoverOpenContext = createContext(false)

/**
 * Row fill for a sidebar hover-card trigger. The card is portaled, so `:hover`
 * ends as soon as the pointer enters the card. `data-sidebar-hover-open` stays
 * until the card closes. The context menu also writes `data-state` onto this
 * row, so the hover card cannot reuse that attribute.
 */
export const sidebarHoverCardRowClass =
  'hover:bg-sidebar-hover data-[sidebar-hover-open=true]:bg-sidebar-hover'

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
    const cardOpen = useContext(SidebarHoverOpenContext)
    const row = isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'data-sidebar-hover-open'?: string }>, {
          'data-sidebar-hover-open': cardOpen ? 'true' : undefined,
        })
      : children
    return (
      // Radix types the trigger ref as an anchor. `asChild` forwards it to the row.
      <HoverCardTrigger asChild {...rest} ref={ref as Ref<HTMLAnchorElement>}>
        {row}
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
  const [hovered, setHovered] = useState(false)
  const shown = open ?? hovered
  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        setHovered(next)
        onOpenChange?.(next)
      }}
      openDelay={300}
      closeDelay={150}
    >
      <SidebarHoverOpenContext.Provider value={shown}>
        {children}
      </SidebarHoverOpenContext.Provider>
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
