import { cn } from '@superone/ui/lib/utils'

interface ResizeHandleLineProps {
  /** Orientation of the line itself: 'vertical' for left/right resize, 'horizontal' for top/bottom resize. */
  orientation: 'vertical' | 'horizontal'
  /** Force the highlight on (while dragging). Otherwise it reveals on the parent `group` hover. */
  active?: boolean
}

/**
 * Simple line highlight for resize handles *inside* a card (mosaic dividers,
 * terminal/activity panel splitters, dockview sashes). Neutral 1px line that
 * reveals on hover/drag — no gradient. The sidebar handle keeps its gradient to
 * distinguish the outer window-level resize.
 */
export function ResizeHandleLine({ orientation, active = false }: ResizeHandleLineProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute bg-foreground transition-opacity',
        orientation === 'vertical' ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
        active ? 'opacity-30' : 'opacity-0 group-hover:opacity-30',
      )}
    />
  )
}
