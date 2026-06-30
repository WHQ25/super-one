import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useBrowserStore, type BrowserSlotMode } from '@/stores/browser'
import { BrowserChrome } from './BrowserChrome'
import { normalizeUrl } from './browser-url'
import { browserNavigate, browserGoBack, browserGoForward, browserReload, browserStop } from './browser-host-api'

interface BrowserViewProps {
  browserId: string
  mode: BrowserSlotMode
}

export function BrowserView({ browserId, mode }: BrowserViewProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const { updateSlot, unregisterSlot } = useBrowserStore.getState()
    let rafId = 0
    const schedule = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => { rafId = 0; updateSlot(browserId, mode, el.getBoundingClientRect()) })
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    const onWin = () => schedule()
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
      unregisterSlot(browserId, mode)
    }
  }, [browserId, mode])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const updateSlot = useBrowserStore.getState().updateSlot
    let rafId = 0
    let last = el.getBoundingClientRect()
    const tick = () => {
      const cur = el.getBoundingClientRect()
      if (cur.left !== last.left || cur.top !== last.top || cur.width !== last.width || cur.height !== last.height) {
        last = cur
        updateSlot(browserId, mode, cur)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [browserId, mode])

  const navigate = useCallback((input: string) => {
    const url = normalizeUrl(input)
    browserNavigate(browserId, url)
    useBrowserStore.getState().patch(browserId, { url })
  }, [browserId])
  const goBack = useCallback(() => browserGoBack(browserId), [browserId])
  const goForward = useCallback(() => browserGoForward(browserId), [browserId])
  const reload = useCallback(() => browserReload(browserId), [browserId])
  const stop = useCallback(() => browserStop(browserId), [browserId])

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <BrowserChrome
        browserId={browserId}
        onNavigate={navigate}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onStop={stop}
      />
      <div ref={contentRef} className="min-h-0 flex-1" />
    </div>
  )
}
