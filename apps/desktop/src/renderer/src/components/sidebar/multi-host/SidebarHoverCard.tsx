import { cloneElement, createContext, forwardRef, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type MutableRefObject, type ReactElement, type ReactNode, type Ref } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@superone/ui/components/ui/hover-card'

/** True while this sidebar hover card is open. Default false outside a card. */
const SidebarHoverOpenContext = createContext(false)

/** The open row. The card is portaled, so placement reads this rect directly. */
const SidebarHoverAnchorContext = createContext<MutableRefObject<HTMLElement | null> | null>(null)

/** Gap kept between the card and the window edge. */
export const SIDEBAR_HOVER_CARD_VIEWPORT_PAD = 8

/**
 * Slide the card, in pixels, from the row's top so the whole card stays in the
 * window. Positive moves it down. The card still opens to the right of the row;
 * this only changes the vertical position. A card taller than the window is
 * capped and scrolled instead of hanging off the bottom.
 */
export function sidebarHoverCardPlacement({
  rowTop,
  cardHeight,
  scrollHeight,
  viewportHeight,
  pad = SIDEBAR_HOVER_CARD_VIEWPORT_PAD,
}: {
  rowTop: number
  cardHeight: number
  scrollHeight: number
  viewportHeight: number
  pad?: number
}): { offset: number; maxHeight: number | null } {
  if (viewportHeight <= 0) return { offset: 0, maxHeight: null }
  const available = Math.max(0, viewportHeight - pad * 2)
  const contentHeight = Math.max(cardHeight, scrollHeight)
  if (contentHeight <= 0 || available <= 0) return { offset: 0, maxHeight: null }
  const capped = contentHeight > available
  const height = capped ? available : contentHeight
  let top = rowTop
  const maxTop = viewportHeight - pad - height
  if (top > maxTop) top = maxTop
  if (top < pad) top = pad
  const shift = top - rowTop
  // Round away from the clipped edge so a fractional pixel cannot stick out.
  const offset = shift < 0 ? Math.floor(shift) : shift > 0 ? Math.ceil(shift) : 0
  return { offset, maxHeight: capped ? available : null }
}

function assignRef<T>(ref: Ref<T> | null | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

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
    const anchorRef = useContext(SidebarHoverAnchorContext)
    const row = isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'data-sidebar-hover-open'?: string }>, {
          'data-sidebar-hover-open': cardOpen ? 'true' : undefined,
        })
      : children
    return (
      // Radix types the trigger ref as an anchor. `asChild` forwards it to the row.
      <HoverCardTrigger
        asChild
        {...rest}
        ref={(node) => {
          assignRef(ref, node)
          if (anchorRef) anchorRef.current = node
        }}
      >
        {row}
      </HoverCardTrigger>
    )
  },
)

/** Opens 4px to the right of the row. Vertically, it moves until the card fits in the window. */
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
  const [placement, setPlacement] = useState<{ offset: number; maxHeight: number | null }>({ offset: 0, maxHeight: null })
  const [cardNode, setCardNode] = useState<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const shown = open ?? hovered
  const fitToWindow = useCallback(() => {
    const row = anchorRef.current
    const card = cardNode
    if (!row || !card) return
    const rowBox = row.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    const next = sidebarHoverCardPlacement({
      rowTop: rowBox.top,
      cardHeight: cardBox.height,
      scrollHeight: card.scrollHeight,
      viewportHeight: window.innerHeight,
    })
    setPlacement((current) => (
      current.offset === next.offset && current.maxHeight === next.maxHeight ? current : next
    ))
  }, [cardNode])
  // A trackpad scroll keeps the pointer over the row until the finger lifts, so
  // the card would stay up for the whole gesture. The sidebar moved; close now.
  // Stay on this row's sidebar. The chat transcript also scrolls while it follows
  // new content, and a window listener would dismiss the card for that too.
  useEffect(() => {
    if (!shown || open !== undefined) return
    const row = document.querySelector('[data-sidebar-hover-open="true"]')
    const sidebar = row?.closest('[data-sidebar-outer]')
    if (!sidebar) return
    const dismiss = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-slot="hover-card-content"]')) return
      setHovered(false)
    }
    sidebar.addEventListener('scroll', dismiss, true)
    return () => sidebar.removeEventListener('scroll', dismiss, true)
  }, [shown, open])
  // The card is portaled, so it is not in the tree on the first layout. Refit
  // once the node exists, and again when its contents or the window change.
  // Radix collision avoidance would flip the card onto the row, so the anchor
  // stays on the row's right and only this vertical slide moves.
  useLayoutEffect(() => {
    if (!shown || !cardNode) return
    fitToWindow()
    const observer = new ResizeObserver(() => fitToWindow())
    observer.observe(cardNode)
    window.addEventListener('resize', fitToWindow)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fitToWindow)
    }
  }, [shown, cardNode, fitToWindow])
  return (
    <HoverCard
      open={shown}
      onOpenChange={(next) => {
        setHovered(next)
        onOpenChange?.(next)
      }}
      openDelay={300}
      closeDelay={150}
    >
      <SidebarHoverAnchorContext.Provider value={anchorRef}>
        <SidebarHoverOpenContext.Provider value={shown}>
          {children}
        </SidebarHoverOpenContext.Provider>
      </SidebarHoverAnchorContext.Provider>
      <HoverCardContent
        ref={setCardNode}
        className={placement.maxHeight == null ? 'w-72 p-3' : 'w-72 overflow-y-auto p-3'}
        style={placement.maxHeight == null ? undefined : { maxHeight: placement.maxHeight }}
        side="right"
        align="start"
        sideOffset={4}
        alignOffset={placement.offset}
        avoidCollisions={false}
      >
        {content}
      </HoverCardContent>
    </HoverCard>
  )
}
