import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useBrowserStore, type BrowserSlotMode } from '@/stores/browser'
import { BrowserChrome } from './BrowserChrome'
import { BrowserNewTab } from './BrowserNewTab'
import { BrowserCertWarning } from './BrowserCertWarning'
import { normalizeUrl, isBlankUrl, hostOf } from './browser-url'
import { browserNavigate, browserGoBack, browserGoForward, browserReload } from './browser-host-api'

interface BrowserViewProps {
  browserId: string
  mode: BrowserSlotMode
}

export function BrowserView({ browserId, mode }: BrowserViewProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const isHome = useBrowserStore((s) => isBlankUrl(s.tabs[browserId]?.url ?? ''))
  const certError = useBrowserStore((s) => s.tabs[browserId]?.certError ?? null)

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

  const certBack = useCallback(() => {
    const store = useBrowserStore.getState()
    if (store.tabs[browserId]?.canGoBack) { browserGoBack(browserId); return }
    browserNavigate(browserId, 'about:blank')
    store.patch(browserId, { url: '', certError: null })
  }, [browserId])
  const certProceed = useCallback(async () => {
    const store = useBrowserStore.getState()
    const err = store.tabs[browserId]?.certError
    if (!err) return
    const host = hostOf(err.url)
    if (host) store.markInsecure(host, err.error)
    await window.app.browserCertProceed(err.url)
    browserReload(browserId)
  }, [browserId])

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <BrowserChrome
        browserId={browserId}
        onNavigate={navigate}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
      />
      <div ref={contentRef} className="min-h-0 flex-1">
        {isHome && <BrowserNewTab onOpen={navigate} />}
        {certError && !isHome && <BrowserCertWarning error={certError} onBack={certBack} onProceed={certProceed} />}
      </div>
    </div>
  )
}
