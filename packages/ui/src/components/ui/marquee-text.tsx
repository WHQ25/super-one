import { useRef, useState, useCallback, useEffect, type CSSProperties } from 'react'
import { cn } from '../../lib/utils'

interface HoverMarqueeOptions {
  /** Controlled hover — omit to let the container drive it from its own pointer events. */
  hovered?: boolean
  /** Suspend scrolling (e.g. while another animation owns the same element). */
  enabled?: boolean
}

/**
 * Shared "scroll the overflowing text while hovered" measurement.
 *
 * The scroll distance can only be known at runtime, so the animation is applied
 * as an inline style: the container clips, the content slides by exactly the
 * amount that is hidden. Callers own the markup — see `MarqueeText` for the
 * plain case and `SessionTitleAnimated` for one that layers this on top of its
 * own char animation.
 */
export function useHoverMarquee<
  C extends HTMLElement = HTMLDivElement,
  T extends HTMLElement = HTMLSpanElement,
>({ hovered, enabled = true }: HoverMarqueeOptions = {}) {
  const containerRef = useRef<C>(null)
  const contentRef = useRef<T>(null)
  const [marqueeStyle, setMarqueeStyle] = useState<CSSProperties | null>(null)
  const controlled = hovered !== undefined

  const startScroll = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    const distance = content.scrollWidth - container.clientWidth
    if (distance <= 0) return
    const duration = Math.max(distance / 30, 1.5)
    setMarqueeStyle({
      '--marquee-dist': `-${distance}px`,
      animationName: 'marquee',
      animationDuration: `${duration}s`,
      animationTimingFunction: 'linear',
      animationIterationCount: 'infinite',
    } as CSSProperties)
  }, [])

  const stopScroll = useCallback(() => setMarqueeStyle(null), [])

  useEffect(() => {
    if (!enabled) {
      stopScroll()
      return
    }
    if (!controlled) return
    if (hovered) startScroll()
    else stopScroll()
  }, [controlled, enabled, hovered, startScroll, stopScroll])

  const hoverHandlers = !controlled && enabled
    ? { onMouseEnter: startScroll, onMouseLeave: stopScroll }
    : {}

  return { containerRef, contentRef, marqueeStyle, scrolling: marqueeStyle !== null, hoverHandlers }
}

interface MarqueeTextProps {
  children: string
  className?: string
  hovered?: boolean
}

export function MarqueeText({ children, className, hovered }: MarqueeTextProps) {
  const { containerRef, contentRef, marqueeStyle, hoverHandlers } = useHoverMarquee<HTMLDivElement, HTMLSpanElement>({ hovered })

  return (
    <div ref={containerRef} className={cn('overflow-hidden', className)} {...hoverHandlers}>
      <span
        ref={contentRef}
        className={cn(
          'inline-block whitespace-nowrap',
          !marqueeStyle && 'truncate max-w-full block',
        )}
        style={marqueeStyle ?? undefined}
      >
        {children}
      </span>
    </div>
  )
}
