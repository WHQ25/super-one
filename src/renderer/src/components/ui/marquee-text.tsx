import { useRef, useState, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface MarqueeTextProps {
  children: string
  className?: string
  hovered?: boolean
}

export function MarqueeText({ children, className, hovered }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scrollStyle, setScrollStyle] = useState<React.CSSProperties | null>(null)
  const controlled = hovered !== undefined

  const startScroll = useCallback(() => {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return
    const distance = text.scrollWidth - container.clientWidth
    if (distance <= 0) return
    const duration = Math.max(distance / 30, 1.5)
    setScrollStyle({
      '--marquee-dist': `-${distance}px`,
      animationName: 'marquee',
      animationDuration: `${duration}s`,
      animationTimingFunction: 'linear',
      animationIterationCount: 'infinite',
    } as React.CSSProperties)
  }, [])

  const stopScroll = useCallback(() => setScrollStyle(null), [])

  useEffect(() => {
    if (!controlled) return
    if (hovered) startScroll()
    else stopScroll()
  }, [controlled, hovered, startScroll, stopScroll])

  return (
    <div
      ref={containerRef}
      className={cn('overflow-hidden', className)}
      {...(!controlled && { onMouseEnter: startScroll, onMouseLeave: stopScroll })}
    >
      <span
        ref={textRef}
        className={cn(
          'inline-block whitespace-nowrap',
          !scrollStyle && 'truncate max-w-full block',
        )}
        style={scrollStyle ?? undefined}
      >
        {children}
      </span>
    </div>
  )
}
