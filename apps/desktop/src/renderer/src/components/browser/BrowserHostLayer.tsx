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
import { ANNOTATE_CANCEL_SCRIPT, ANNOTATE_CTX_TRACKER_SCRIPT, ANNOTATE_MSG_PREFIX } from './browser-annotate-script'
import { isBlankUrl, sameOrigin } from './browser-url'
import { useBrowserContextMenu } from './browser-context-menu'
import { openBrowserTab } from '@/components/activity/activity-panel-api'

// Fallback viewport used only while capturing a slotless tab (a background session's
// tab has no dock geometry). Width matches the screenshot cap so no downscale needed.
const CAPTURE_VIEWPORT = { width: 1280, height: 800 }

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
    return window.app.onBrowserOpenTab(({ webContentsId, url, background }) => {
      // Inherit the source tab's owner so a Cmd/Ctrl+click'd tab lands in the same
      // session's activity panel instead of leaking into the current one.
      const sourceId = browserIdByWebContentsId(webContentsId)
      const owner = sourceId ? useBrowserStore.getState().tabs[sourceId]?.owner ?? null : null
      openBrowserTab(url, undefined, owner, { background })
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
  const emulation = useBrowserStore((s) => s.emulations[browserId])
  const capturing = useBrowserStore((s) => (s.captureRefs[browserId] ?? 0) > 0)
  const activityShown = useActivityPanelStore((s) => s.showPanel)
  const activitySide = useActivityPanelStore((s) => s.side)
  const annotating = useBrowserStore((s) => s.annotatingId === browserId)
  const home = useBrowserStore((s) => isBlankUrl(s.tabs[browserId]?.url ?? ''))
  const certErrored = useBrowserStore((s) => s.tabs[browserId]?.certError != null)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const lastRecordedUrl = useRef<string | null>(null)
  const initialSrcRef = useRef(useBrowserStore.getState().tabs[browserId]?.url || 'about:blank')
  const { t } = useTranslation()
  const { handleContextMenu, menuNode } = useBrowserContextMenu(browserId)
  const contextMenuRef = useRef(handleContextMenu)
  contextMenuRef.current = handleContextMenu

  useEffect(() => {
    if (!annotating) return
    const wv = webviewRef.current
    if (!wv) { useBrowserStore.getState().stopAnnotate(); return }
    let done = false
    const onConsole = (e: Electron.ConsoleMessageEvent) => {
      if (!e.message.startsWith(ANNOTATE_MSG_PREFIX)) return
      try {
        const payload = JSON.parse(e.message.slice(ANNOTATE_MSG_PREFIX.length))
        void handleAnnotationMessage(browserId, payload)
        if (payload?.op === 'commit' && useBrowserStore.getState().annotateQuick) {
          useBrowserStore.getState().stopAnnotate()
        }
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
    }, useBrowserStore.getState().annotateQuick)
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
    const onContextMenu = (e: Electron.ContextMenuEvent) => contextMenuRef.current(wv, e)
    const injectCtxTracker = () => void browserExecJs(browserId, ANNOTATE_CTX_TRACKER_SCRIPT).catch(() => {})

    injectCtxTracker()
    wv.addEventListener('dom-ready', injectCtxTracker)
    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('context-menu', onContextMenu)
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
      wv.removeEventListener('dom-ready', injectCtxTracker)
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('context-menu', onContextMenu)
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
  const hasSlot = slot != null && slot.width > 0 && slot.height > 0
  const mounted = presentationMatches && hasSlot
  const hostShown = slot?.mode !== 'panel' || activityShown
  const visible = mounted && hostShown && !home && !certErrored
  // A screenshot transiently pulls a hidden/background tab into the viewport and
  // masks it with opacity:0 — Chromium won't rasterize a layer parked off-screen,
  // so capturePage would hang otherwise. Outside capture, hidden tabs keep their
  // cheap resting state (off-screen if slotted, so live pages don't reload during
  // mosaic/collapse; display:none if slotless) rather than always compositing,
  // which would cost GPU + un-throttled CPU for every background tab.
  const inViewport = visible || capturing
  const width = hasSlot ? slot!.width : CAPTURE_VIEWPORT.width
  const height = hasSlot ? slot!.height : CAPTURE_VIEWPORT.height

  return (
    <>
    <div
      data-browser-host=""
      data-browser-id={browserId}
      data-browser-presentation={slot?.mode}
      style={{
        position: 'absolute',
        left: inViewport ? (slot?.left ?? 0) : -99999,
        top: inViewport ? (slot?.top ?? 0) : 0,
        width,
        height,
        display: mounted || capturing ? 'block' : 'none',
        opacity: visible ? 1 : 0,
        pointerEvents: visible && !resizing ? 'auto' : 'none',
        overflow: 'hidden',
        borderBottomLeftRadius: (layoutMode === 'coding' && activitySide === 'left') || (layoutMode === 'canvas' && slot?.mode === 'canvas') ? 'var(--radius-xl)' : undefined,
        borderBottomRightRadius: (layoutMode === 'coding' && activitySide === 'right') || (layoutMode === 'canvas' && slot?.mode === 'canvas') ? 'var(--radius-xl)' : undefined,
      }}
    >
      <webview
        ref={webviewRef}
        src={initialSrcRef.current}
        partition="persist:browser"
        {...({ allowpopups: 'true' } as Record<string, string>)}
        style={emulation ? { width: emulation.width, height: emulation.height } : { width: '100%', height: '100%' }}
      />
    </div>
    {menuNode}
    </>
  )
}
