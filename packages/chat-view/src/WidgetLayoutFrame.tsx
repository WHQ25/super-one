import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { WidgetLayout } from '@superone/shared/generative-ui/types'
import { WIDGET_FIXED_LAYOUT_WIDTH } from '@superone/shared/generative-ui/widget-srcdoc'

interface Fit {
  scale: number
  height: number
}

/**
 * Where a `fixed` widget meets a container narrower than its design width.
 *
 * The widget is laid out at `WIDGET_FIXED_LAYOUT_WIDTH` and scaled down as a whole, so a
 * mockup keeps the proportions it has on the desktop instead of reflowing into a tall
 * column on a phone. The scale sits outside the frame: the widget document never learns
 * it was shrunk, and the height it reports stays in its own pixels — this box multiplies
 * it back into the transcript's.
 *
 * A container at least as wide as the design width renders the widget as written, and a
 * `fluid` widget passes straight through. The wrappers stay mounted either way, so a
 * `layout` that streams in after the preview started does not remount the widget.
 */
export function WidgetLayoutFrame({ layout, children }: { layout?: WidgetLayout; children: ReactNode }) {
  const [outer, setOuter] = useState<HTMLDivElement | null>(null)
  const [inner, setInner] = useState<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<Fit | null>(null)
  const fixed = layout === 'fixed'

  useLayoutEffect(() => {
    if (!fixed || !outer || !inner) return
    const measure = () => {
      const scale = Math.min(1, outer.getBoundingClientRect().width / WIDGET_FIXED_LAYOUT_WIDTH)
      // `offsetHeight` is the untransformed layout height, which is what gets scaled.
      const height = inner.offsetHeight
      setFit((prev) => (prev?.scale === scale && prev.height === height ? prev : { scale, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [fixed, outer, inner])

  const scaled = fixed && fit && fit.scale < 1 ? fit : null
  return (
    <div ref={setOuter} style={scaled ? { height: scaled.height * scaled.scale } : undefined}>
      <div
        ref={setInner}
        style={scaled
          ? { width: WIDGET_FIXED_LAYOUT_WIDTH, transform: `scale(${scaled.scale})`, transformOrigin: '0 0' }
          : undefined}
      >
        {children}
      </div>
    </div>
  )
}
