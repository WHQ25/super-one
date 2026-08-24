import { useCallback, useRef } from 'react'
import { useBrowserStore, type BrowserSlotMode } from '@/stores/browser'
import { useSlotBounds } from '@/hooks/useSlotBounds'
import { BrowserChrome } from './BrowserChrome'
import { BrowserNewTab } from './BrowserNewTab'
import { BrowserCertWarning } from './BrowserCertWarning'
import { normalizeUrl, isBlankUrl, hostOf } from './browser-url'
import { browserNavigate, browserGoBack, browserGoForward, browserReload } from './browser-host-api'
import { cn } from '@superone/ui/lib/utils'

interface BrowserViewProps {
  browserId: string
  mode: BrowserSlotMode
  className?: string
  interactive?: boolean
  showChrome?: boolean
  trackBoundsContinuously?: boolean
}

export function BrowserView({
  browserId,
  mode,
  className,
  interactive = true,
  showChrome = true,
  trackBoundsContinuously = false,
}: BrowserViewProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const isHome = useBrowserStore((s) => {
    const tab = s.tabs[browserId]
    return isBlankUrl(tab?.url ?? '') && !tab?.hasCustomBlankContent
  })
  const certError = useBrowserStore((s) => s.tabs[browserId]?.certError ?? null)

  useSlotBounds(
    contentRef,
    `${browserId}:${mode}`,
    (rect) => useBrowserStore.getState().updateSlot(browserId, mode, rect),
    () => useBrowserStore.getState().unregisterSlot(browserId, mode),
    trackBoundsContinuously,
  )

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
    <div className={cn('flex h-full w-full flex-col bg-transparent', className)}>
      {showChrome && (
        <BrowserChrome
          browserId={browserId}
          onNavigate={navigate}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
        />
      )}
      <div
        ref={contentRef}
        className={cn('min-h-0 flex-1', interactive && (isHome || certError) ? 'pointer-events-auto' : 'pointer-events-none')}
      >
        {isHome && <BrowserNewTab onOpen={navigate} />}
        {certError && !isHome && <BrowserCertWarning error={certError} onBack={certBack} onProceed={certProceed} />}
      </div>
    </div>
  )
}
