import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'

export interface PortableMessageMenuItem {
  id: string
  icon: ReactNode
  label: string
  onSelect: () => void
}

/** Room the menu needs above the bubble before it flips underneath it. */
const FLIP_MARGIN_PX = 8

/**
 * The long-press menu that floats over a user bubble. It is positioned
 * against its offset parent — the bubble's `relative` wrapper — so it never
 * has to know where the transcript scrolled to; a full-screen transparent
 * backdrop dismisses it, as does any scroll, because a menu that rides along
 * with a scrolling transcript reads as stuck to the finger.
 *
 * Copy is the only item today; the list shape is what future items plug into.
 */
export function PortableMessageMenu({
  items,
  align,
  onClose,
}: {
  items: PortableMessageMenuItem[]
  /** Which edge of the bubble the menu hugs — the side the bubble itself sits on. */
  align: 'start' | 'end'
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<'above' | 'below'>('above')

  // Flip under the bubble when it is pressed near the top of the viewport,
  // where "above" would land the menu under the safe area or off-screen.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const anchor = panel?.parentElement
    if (!panel || !anchor) return
    const safeTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')) || 0
    const room = anchor.getBoundingClientRect().top - safeTop
    setPlacement(room < panel.offsetHeight + FLIP_MARGIN_PX ? 'below' : 'above')
  }, [])

  useEffect(() => {
    const dismiss = () => onClose()
    // Capture phase so a nested scroller's (non-bubbling) scroll still reaches us.
    document.addEventListener('scroll', dismiss, { capture: true, passive: true })
    globalThis.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('scroll', dismiss, { capture: true })
      globalThis.removeEventListener('resize', dismiss)
    }
  }, [onClose])

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        data-testid="message-menu-backdrop"
        onPointerDown={(event) => { event.preventDefault(); onClose() }}
      />
      <div
        ref={panelRef}
        role="menu"
        data-testid="message-menu"
        data-placement={placement}
        className={cn(
          'portable-message-menu absolute z-50 flex items-stretch overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md',
          align === 'end' ? 'right-0' : 'left-0',
          placement === 'above' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        )}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={item.onSelect}
            className="flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap active:bg-muted"
          >
            <span className="flex size-3.5 items-center justify-center [&>svg]:size-3.5">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}
