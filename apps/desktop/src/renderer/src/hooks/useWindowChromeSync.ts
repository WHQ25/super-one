import { useEffect, type RefObject } from 'react'
import { readWindowChromeColors } from '@/lib/window-chrome-colors'

const isWindows = window.app?.platform === 'win32'

/**
 * Keeps the native Windows caption-button overlay tinted like the title strip the
 * given element paints. No-op elsewhere: macOS traffic lights are composited over
 * the window and need no colour.
 */
export function useWindowChromeSync(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!isWindows) return
    const el = ref.current
    if (!el) return

    let applied = ''
    const push = (): void => {
      const colors = readWindowChromeColors(el)
      if (!colors) return
      const key = `${colors.backgroundColor}|${colors.symbolColor}`
      if (key === applied) return
      applied = key
      window.app.setWindowChromeColors(colors)
    }

    push()
    // `useHarnessTheme` funnels every theme input onto <html>: the `dark` and
    // `liquid-glass` classes, `data-harness`, and the inline brand channels. One
    // observer on those attributes covers all of them without re-deriving the
    // token math here.
    const observer = new MutationObserver(push)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-harness'],
    })
    return () => observer.disconnect()
  }, [ref])
}
