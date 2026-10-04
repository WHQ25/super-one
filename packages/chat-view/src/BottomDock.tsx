import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { requestNative } from './bridge'

/**
 * What the transcript keeps above the composer: mod panes, a command's output,
 * the pending question. Pinned to the bottom of the document, which on the
 * phone is the top of the native composer; its height pads the transcript
 * (`--bottom-dock`) so the last turn is never under it.
 *
 * A field focused inside the dock is scrolled back into view on each resize.
 * Native hears when such a field holds the keyboard: the composer below does
 * not take it for its own and expand, and iOS leaves the keyboard inset to the
 * WebView instead of shrinking it too.
 */
export function BottomDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const dock = ref.current
    if (!dock) return
    const root = document.documentElement
    const scroller = document.scrollingElement ?? root
    const measure = () => {
      // Read before the padding grows: a reader at the bottom stays there.
      const atBottom = scroller.scrollHeight - scroller.scrollTop - window.innerHeight < 4
      root.style.setProperty('--bottom-dock', `${dock.offsetHeight}px`)
      if (atBottom) scroller.scrollTop = scroller.scrollHeight
    }
    let frame = 0
    const reveal = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement
        if (focused instanceof HTMLElement && dock.contains(focused)) focused.scrollIntoView({ block: 'nearest' })
      })
    }
    let typing = false
    const report = (next: boolean) => {
      if (next === typing) return
      typing = next
      requestNative('documentInputFocus', { focused: next })
    }
    // Read from `activeElement`, not the events: a focused field removed with
    // its card (answered, resolved elsewhere) gets no focusout on WebKit.
    const sync = () => {
      const focused = document.activeElement
      report((focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && dock.contains(focused))
    }
    const onFocusIn = () => {
      sync()
      reveal()
    }
    // During focusout `activeElement` is still on its way to the next target.
    let settle: ReturnType<typeof setTimeout> | undefined
    const onFocusOut = () => {
      clearTimeout(settle)
      settle = setTimeout(sync)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(dock)
    const removals = new MutationObserver(sync)
    removals.observe(dock, { childList: true, subtree: true })
    measure()
    window.addEventListener('resize', reveal)
    dock.addEventListener('focusin', onFocusIn)
    dock.addEventListener('focusout', onFocusOut)
    return () => {
      observer.disconnect()
      removals.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(settle)
      window.removeEventListener('resize', reveal)
      dock.removeEventListener('focusin', onFocusIn)
      dock.removeEventListener('focusout', onFocusOut)
      report(false)
      root.style.removeProperty('--bottom-dock')
    }
  }, [])
  return (
    <div
      ref={ref}
      data-bottom-dock=""
      // Same plane as the native composer below it; a hairline marks the seam with the transcript.
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85vh] flex-col gap-2 overflow-y-auto overscroll-contain border-t border-border/60 bg-background pb-2 empty:hidden"
    >
      {children}
    </div>
  )
}
