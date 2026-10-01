import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'

export function tabChipClass(active: boolean): string {
  return cn(
    'flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-[max-width,color,background-color] duration-200',
    // The active tab is the one you are reading, so it keeps the room. Clamping the
    // rest harder is what keeps a full strip legible instead of two tabs wide.
    active
      ? 'max-w-[200px] bg-muted text-foreground'
      : 'max-w-[128px] text-muted-foreground hover:text-foreground',
  )
}

/**
 * A tab label that dissolves its tail rather than showing an ellipsis.
 *
 * The mask has to be measured, not always-on: applied unconditionally it would
 * wash out the last characters of every title that already fits. `scrollWidth`
 * vs `clientWidth` is the only thing that knows, so a ResizeObserver re-asks
 * whenever the flex row hands this span a different width.
 */
export function TabTitle({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [clipped, setClipped] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={ref}
      className={cn(
        'min-w-0 overflow-hidden whitespace-nowrap text-xs',
        clipped && '[mask-image:linear-gradient(to_right,black_calc(100%-1.25rem),transparent)]',
      )}
    >
      {children}
    </span>
  )
}

export function TabActionButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <motion.button
      initial={false}
      animate={{
        width: active ? 16 : 0,
        marginLeft: active ? 2 : 0,
        opacity: active ? 1 : 0,
      }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      onClick={onClick}
      className="flex h-4 shrink-0 items-center justify-center overflow-hidden rounded text-foreground/60 hover:text-foreground"
      title={title}
    >
      {children}
    </motion.button>
  )
}

