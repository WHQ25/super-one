import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '@/stores/browser'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useSashResizing } from '@/hooks/useSashResizing'
import { useGlobalDragging } from '@/hooks/useGlobalDragging'
import { registerBrowserWebview, browserExecJs, pushBrowserConsole, clearBrowserConsole, browserIdByWebContentsId } from './browser-host-api'
import { useBrowserAutomationHost } from './browser-automation-runtime'
import { buildSessionScript, handleAnnotationMessage } from './browser-annotate-flow'
import { ANNOTATE_CANCEL_SCRIPT, ANNOTATE_MSG_PREFIX } from './browser-annotate-script'
import { isBlankUrl, sameOrigin } from './browser-url'

export function BrowserHostLayer() {
  const ids = useBrowserStore(useShallow((s) => Object.keys(s.tabs)))
  const layoutMode = useAppStore((s) => s.layoutMode)
  const sashResizing = useSashResizing()
  const globalDragging = useGlobalDragging()
  const resizing = sashResizing || globalDragging
  useBrowserAutomationHost()

  useEffect(() => {
    return window.app.onBrowserAnnotateShortcut((webContentsId) => {
      const id = browserIdByWebContentsId(webContentsId)
      if (!id) return
      const store = useBrowserStore.getState()
      if (store.annotatingId === id) store.stopAnnotate()
      else store.startAnnotate(id)
    })
  }, [])

  useEffect(() => {
    return window.app.onBrowserCertError(({ webContentsId, url, error }) => {
      const id = browserIdByWebContentsId(webContentsId)
      if (!id) return
      useBrowserStore.getState().patch(id, { certError: { url, error }, loading: false })
    })
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {ids.map((id) => (
        <PersistentBrowser key={id} browserId={id} layoutMode={layoutMode} resizing={resizing} />
      ))}
    </div>
  )
}

function PersistentBrowser({ browserId, layoutMode, resizing }: { browserId: string; layoutMode: 'canvas' | 'coding'; resizing: boolean }) {
  const slot = useBrowserStore((s) => s.slots[browserId])
  const activityShown = useActivityPanelStore((s) => s.showPanel)
  const annotating = useBrowserStore((s) => s.annotatingId === browserId)
  const home = useBrowserStore((s) => isBlankUrl(s.tabs[browserId]?.url ?? ''))
  const certErrored = useBrowserStore((s) => s.tabs[browserId]?.certError != null)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const lastRecordedUrl = useRef<string | null>(null)
  const initialSrcRef = useRef(useBrowserStore.getState().tabs[browserId]?.url || 'about:blank')
  const { t } = useTranslation()

  useEffect(() => {
    if (!annotating) return
    const wv = webviewRef.current
    if (!wv) { useBrowserStore.getState().stopAnnotate(); return }
    let done = false
    const onConsole = (e: Electron.ConsoleMessageEvent) => {
      if (!e.message.startsWith(ANNOTATE_MSG_PREFIX)) return
      try {
        void handleAnnotationMessage(browserId, JSON.parse(e.message.slice(ANNOTATE_MSG_PREFIX.length)))
      } catch {
        // malformed payload — ignore
      }
    }
    wv.addEventListener('console-message', onConsole)
    const script = buildSessionScript({
      placeholder: t('chat.browser.annotatePlaceholder'),
      confirm: t('chat.browser.annotateConfirm'),
      cancel: t('chat.browser.annotateCancel'),
      screenshot: t('chat.browser.annotateScreenshot'),
      sColor: t('chat.browser.styleColor'),
      sBg: t('chat.browser.styleBackground'),
      sSize: t('chat.browser.styleSize'),
      sWeight: t('chat.browser.styleWeight'),
      sRadius: t('chat.browser.styleRadius'),
      sPadding: t('chat.browser.stylePadding'),
    })
    void browserExecJs(browserId, script).catch(() => {}).finally(() => {
      if (done) return
      done = true
      wv.removeEventListener('console-message', onConsole)
      useBrowserStore.getState().stopAnnotate()
    })
    return () => {
      done = true
      wv.removeEventListener('console-message', onConsole)
      void browserExecJs(browserId, ANNOTATE_CANCEL_SCRIPT)
    }
  }, [annotating, browserId, t])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const unregister = registerBrowserWebview(browserId, wv)
    const patch = useBrowserStore.getState().patch

    const recordVisit = () => {
      const u = wv.getURL()
      if (u && u !== lastRecordedUrl.current) {
        lastRecordedUrl.current = u
        void window.app.recordBrowserHistory(u, wv.getTitle())
      }
    }
    const syncNav = () => {
      const url = wv.getURL()
      const prev = useBrowserStore.getState().tabs[browserId]
      // On a cross-origin nav (incl. back/forward) the old favicon/title no longer
      // apply — clear them so the tab follows the address instead of showing a stale
      // icon while the new page (or the origin cache) resolves.
      const reset = isBlankUrl(url)
        ? { favicon: null, title: '' }
        : prev && !sameOrigin(prev.url, url)
          ? { favicon: null }
          : {}
      patch(browserId, { url, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), ...reset })
    }
    const onStart = () => patch(browserId, { loading: true })
    const onStop = () => { patch(browserId, { loading: false }); syncNav(); recordVisit() }
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => { patch(browserId, { title: e.title }); void window.app.recordBrowserHistory(wv.getURL(), e.title, true) }
    const onFavicon = (e: Electron.PageFaviconUpdatedEvent) => {
      const favicon = e.favicons[0] ?? null
      patch(browserId, { favicon })
      // Prime the shared origin-keyed favicon cache so chat markdown links and
      // bookmarks reuse the exact icon just captured, without re-resolving.
      if (favicon) void window.app.cacheFavicon(wv.getURL(), favicon, document.documentElement.classList.contains('dark'))
    }
    const onNavigate = () => { syncNav(); recordVisit() }
    const onFail = (e: Electron.DidFailLoadEvent) => { if (e.errorCode !== -3) patch(browserId, { loading: false }) }
    const onConsole = (e: Electron.ConsoleMessageEvent) => pushBrowserConsole(browserId, e.level, e.message)
    const onNavigateClearConsole = (e: Electron.DidStartNavigationEvent) => {
      clearBrowserConsole(browserId)
      if (e.isMainFrame && useBrowserStore.getState().tabs[browserId]?.certError) patch(browserId, { certError: null })
    }

    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('did-start-navigation', onNavigateClearConsole)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('page-favicon-updated', onFavicon)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      unregister()
      clearBrowserConsole(browserId)
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('did-start-navigation', onNavigateClearConsole)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('page-favicon-updated', onFavicon)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
      wv.removeEventListener('did-fail-load', onFail)
    }
  }, [browserId])

  const presentationMatches = slot != null && (
    (slot.mode === 'panel' && layoutMode === 'coding') ||
    (slot.mode === 'canvas' && layoutMode === 'canvas')
  )
  const mounted = presentationMatches && slot != null && slot.width > 0 && slot.height > 0
  const hostShown = slot?.mode !== 'panel' || activityShown
  const visible = mounted && hostShown && !home && !certErrored

  return (
    <div
      data-browser-host=""
      data-browser-id={browserId}
      data-browser-presentation={slot?.mode}
      style={{
        position: 'absolute',
        left: visible ? slot!.left : -99999,
        top: slot?.top ?? 0,
        width: slot?.width ?? 0,
        height: slot?.height ?? 0,
        display: mounted ? 'block' : 'none',
        pointerEvents: visible && !resizing ? 'auto' : 'none',
        overflow: 'hidden',
      }}
    >
      <webview
        ref={webviewRef}
        src={initialSrcRef.current}
        partition="persist:browser"
        {...({ allowpopups: 'true' } as Record<string, string>)}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
