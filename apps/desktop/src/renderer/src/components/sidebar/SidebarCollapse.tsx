import { useLayoutEffect, useRef, useState, type ReactNode, type TransitionEvent } from 'react'
import { cn } from '@superone/ui/lib/utils'

/** Same fold as the pinned session list. */
const COLLAPSE_TIMING = 'grid transition-[grid-template-rows] duration-[120ms] ease-out motion-reduce:transition-none'
const HEIGHT_MS = 120

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Fold a sidebar group open and shut the way pinned sessions do.
 * The body stays mounted through the close so the row can ease to nothing,
 * then drops when `unmountClosed` is set. A group that starts closed never
 * mounts its body.
 */
export function SidebarCollapse({
  open,
  id,
  className,
  innerClassName,
  fill = false,
  unmountClosed = false,
  children,
}: {
  open: boolean
  id?: string
  className?: string
  innerClassName?: string
  /** Stretch with the pane while open. A closed group gives that space back. */
  fill?: boolean
  /** Drop children after the close animation. */
  unmountClosed?: boolean
  children: ReactNode
}) {
  const openRef = useRef(open)
  const [expanded, setExpanded] = useState(open)
  const [mounted, setMounted] = useState(() => open || !unmountClosed)

  useLayoutEffect(() => {
    openRef.current = open
    if (!open) {
      setExpanded(false)
      if (unmountClosed && prefersReducedMotion()) setMounted(false)
      return
    }
    // Mount and open before paint. The last frame was 0fr, so the row still eases.
    setMounted(true)
    setExpanded(true)
  }, [open, unmountClosed])

  const onTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-rows') return
    if (!openRef.current && unmountClosed) setMounted(false)
  }

  return (
    <div
      id={id}
      className={cn(
        COLLAPSE_TIMING,
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        fill && expanded && 'min-h-0 flex-1',
        className,
      )}
      inert={expanded ? undefined : true}
      aria-hidden={expanded ? undefined : true}
      onTransitionEnd={onTransitionEnd}
    >
      <div className={cn('overflow-hidden', fill && expanded && 'flex min-h-0 flex-1 flex-col', innerClassName)}>
        {mounted ? children : null}
      </div>
    </div>
  )
}

/**
 * Ease between two content heights with the same 120ms ease-out as
 * `SidebarCollapse`. Used when a group changes what it shows (a project
 * opening onto its full list) instead of folding all the way shut.
 * Focus panes pass `fill` and skip the pixel row, so the list can still grow.
 */
export function SidebarHeightMorph({
  morphKey,
  fill = false,
  className,
  children,
}: {
  morphKey: unknown
  fill?: boolean
  className?: string
  children: ReactNode
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const keyRef = useRef(morphKey)
  // Last content height. Captured after layout, so a later key change still
  // knows the height from before this commit replaced the children.
  const fromHeightRef = useRef<number | null>(null)
  const animationRef = useRef<Animation | null>(null)

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || typeof ResizeObserver === 'undefined') return
    const remember = () => {
      fromHeightRef.current = inner.offsetHeight
    }
    remember()
    const observer = new ResizeObserver(remember)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    const keyChanged = keyRef.current !== morphKey
    const from = fromHeightRef.current
    keyRef.current = morphKey
    if (!inner) return
    const to = inner.offsetHeight
    fromHeightRef.current = to
    if (!keyChanged || fill || from == null || !outer) return
    if (from === to || typeof outer.animate !== 'function' || prefersReducedMotion()) return
    animationRef.current?.cancel()
    animationRef.current = outer.animate(
      [{ gridTemplateRows: `${from}px` }, { gridTemplateRows: `${to}px` }],
      { duration: HEIGHT_MS, easing: 'ease-out' },
    )
  }, [morphKey, fill])

  return (
    <div
      ref={outerRef}
      className={cn(fill ? 'flex min-h-0 flex-1 flex-col' : 'grid', className)}
      style={fill ? undefined : { overflow: 'hidden' }}
    >
      <div ref={innerRef} className={cn('min-h-0', fill && 'flex min-h-0 flex-1 flex-col')}>{children}</div>
    </div>
  )
}
