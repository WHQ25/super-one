import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'

export interface ToolbarControl {
  id: string
  /** Row label in the settings panel. */
  label: string
  /** The toolbar form. */
  control: ReactNode
  /** The settings panel form; defaults to `control`. */
  panelControl?: ReactNode
}

const GAP = 2

/**
 * Shows at most `max` controls in priority order on one row and moves the rest, plus any that do
 * not fit, into a settings panel. Widths come from an invisible copy of the candidates, so labels
 * can change freely.
 */
export function OverflowControls({ controls, max, moreLabel, disabled }: { controls: ToolbarControl[]; max: number; moreLabel: string; disabled?: boolean }) {
  const row = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const candidates = controls.slice(0, max)
  const [visible, setVisible] = useState(candidates.length)

  useLayoutEffect(() => {
    const fit = () => {
      const available = row.current?.clientWidth ?? 0
      const widths = Array.from(ruler.current?.children ?? [], child => (child as HTMLElement).offsetWidth)
      const more = widths.pop() ?? 0
      // Not laid out yet (first frame, hidden pane, jsdom): show the candidates rather than nothing.
      if (!available) return setVisible(widths.length)
      const total = widths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, widths.length - 1)
      if (controls.length <= max && total <= available) return setVisible(widths.length)
      let used = more
      let count = 0
      for (const width of widths) {
        if (used + GAP + width > available) break
        used += GAP + width
        count++
      }
      setVisible(count)
    }
    fit()
    const observer = new ResizeObserver(fit)
    if (row.current) observer.observe(row.current)
    if (ruler.current) observer.observe(ruler.current)
    return () => observer.disconnect()
  }, [controls.length, max])

  const hidden = controls.slice(visible)
  const moreButton = (
    <IconButton tooltip={moreLabel} className="size-6 shrink-0">
      <SlidersHorizontal />
    </IconButton>
  )
  return (
    <div ref={row} inert={disabled} className={cn('relative flex min-w-0 flex-1 items-center gap-0.5 overflow-clip', disabled && 'opacity-60')}>
      <div ref={ruler} aria-hidden="true" inert className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-0.5 whitespace-nowrap">
        {candidates.map(item => <div key={item.id} className="shrink-0">{item.control}</div>)}
        <div className="shrink-0">{moreButton}</div>
      </div>
      {controls.slice(0, visible).map(item => <div key={item.id} className="shrink-0">{item.control}</div>)}
      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>{moreButton}</PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 p-1" onOpenAutoFocus={event => event.preventDefault()}>
            <div className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">{moreLabel}</div>
            {hidden.map(item => (
              <div key={item.id} className="flex min-h-8 items-center justify-between gap-3 rounded-md px-2 py-1">
                <span className="min-w-0 truncate text-sm">{item.label}</span>
                <div className="flex shrink-0 items-center">{item.panelControl ?? item.control}</div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
