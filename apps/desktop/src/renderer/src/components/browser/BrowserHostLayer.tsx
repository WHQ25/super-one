import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '@/stores/browser'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { panelCornersForSlot } from '@/components/activity/activity-panel-corners'
import { useActivityPanelOnScreen } from '@/hooks/useActivityPanelOnScreen'
import { useAppStore } from '@/stores/app'
import { useSashResizing } from '@/hooks/useSashResizing'
import { useGlobalDragging } from '@/hooks/useGlobalDragging'
import { useFullscreen } from '@/hooks/useFullscreen'
import { registerBrowserWebview, browserExecJs, pushBrowserConsole, clearBrowserConsole, browserIdByWebContentsId } from './browser-host-api'
import { useBrowserAutomationHost } from './browser-automation-runtime'
import { buildSessionScript, handleAnnotationMessage } from './browser-annotate-flow'
import { ANNOTATE_CANCEL_SCRIPT, ANNOTATE_CTX_TRACKER_SCRIPT, ANNOTATE_MSG_PREFIX } from './browser-annotate-script'
import { isBlankUrl, sameOrigin } from './browser-url'
import { BROWSER_CANVAS_PROBE, BROWSER_LIGHT_CANVAS, browserCanvasColor, isBrowserCanvasProbe } from './browser-canvas'
import { useBrowserContextMenu } from './browser-context-menu'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { ACTIVITY_PANEL_TRANSITION } from '@/lib/layout-constants'
import { Z } from '@/lib/z-layers'
import { BrowserPictureInPicture } from './BrowserPictureInPicture'
import { BROWSER_FALLBACK_VIEWPORT, resolveBrowserPipViewport } from './browser-pip-layout'
import { selectViewfinderTarget, useAgentViewfinderStore } from '@/stores/agent-viewfinder'

export function BrowserHostLayer() {
  const ids = useBrowserStore(useShallow((s) => Object.keys(s.tabs)))
  const sashResizing = useSashResizing()
  const globalDragging = useGlobalDragging()
  const resizing = sashResizing || globalDragging
  const overlayOpen = useBrowserStore((s) => s.expandedBrowserId != null)
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
    // Expanded still ranks below the modal tier — see `Z` for why that is not optional.
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: overlayOpen ? Z.HOST_BROWSER_EXPANDED : Z.HOST_BROWSER }}>
      {ids.map((id) => (
        <PersistentBrowser key={id} browserId={id} resizing={resizing} />
      ))}
      <BrowserPictureInPicture />
    </div>
  )
}

function PersistentBrowser({ browserId, resizing }: { browserId: string; resizing: boolean }) {
  const panelSlot = useBrowserStore((s) => s.slots[browserId])
  const pipSlot = useBrowserStore((s) => s.pipSlots[browserId])
  const overlaySlot = useBrowserStore((s) => s.overlaySlots[browserId])
  const owner = useBrowserStore((s) => s.tabs[browserId]?.owner ?? null)
  const exactAutomationPreviewReady = useBrowserStore((s) => s.automationPreviewReady?.[browserId] === true)
  const activeTarget = useAgentViewfinderStore((state) => selectViewfinderTarget(state, owner))
  const automationPreview = activeTarget?.kind === 'browser'
    && activeTarget.targetId === browserId
    && exactAutomationPreviewReady
  const previewExpanded = useBrowserStore((s) => s.expandedBrowserId === browserId)
  const previewPinned = useBrowserStore((s) => s.pinnedPipBrowserId === browserId)
  const previewHidden = useBrowserStore((s) => s.hiddenPreviewBrowserId === browserId)
  const emulation = useBrowserStore((s) => s.emulations[browserId])
  const capturing = useBrowserStore((s) => (s.captureRefs[browserId] ?? 0) > 0)
  const fullResolutionCapturing = useBrowserStore((s) => (s.fullResolutionCaptureRefs[browserId] ?? 0) > 0)
  const activityShown = useActivityPanelOnScreen()
  const activitySide = useActivityPanelStore((s) => s.side)
  // Match the main card corners: fullscreen drops outer radii on screen edges.
  const isFullscreen = useFullscreen()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const roundLeft = !isFullscreen || showSidebar
  const roundRight = !isFullscreen
  const panelBounds = useActivityPanelStore((s) => s.bounds)
  const annotating = useBrowserStore((s) => s.annotatingId === browserId)
  const home = useBrowserStore((s) => {
    const tab = s.tabs[browserId]
    return isBlankUrl(tab?.url ?? '') && !tab?.hasCustomBlankContent
  })
  const certErrored = useBrowserStore((s) => s.tabs[browserId]?.certError != null)
  const canvas = useBrowserStore((s) => s.tabs[browserId]?.canvas ?? BROWSER_LIGHT_CANVAS)
  const webviewRef = useRef<Electron.WebviewTag>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const zoomLevelRef = useRef(0)
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
    // Chromium's canvas colour depends on the document's used colour-scheme, so it
    // is re-read per navigation: at dom-ready for the common case, and again once
    // loading settles for a page whose scheme arrives with a late stylesheet.
    const syncCanvas = () => {
      void browserExecJs(browserId, BROWSER_CANVAS_PROBE)
        .then((probe) => {
          // Patch only on a real change: `tabs` is a shared object, so rewriting it
          // per navigation would re-render every tab subscriber for nothing.
          const next = browserCanvasColor(isBrowserCanvasProbe(probe) ? probe : null)
          if (useBrowserStore.getState().tabs[browserId]?.canvas !== next) patch(browserId, { canvas: next })
        })
        .catch(() => {
          // webview mid-teardown, or a page that refuses script evaluation: keep the
          // canvas we last resolved rather than flashing a different one
        })
    }
    const onStop = () => {
      syncCanvas()
      patch(browserId, { loading: false })
      useBrowserStore.getState().markAutomationPreviewReady(browserId)
      syncNav()
      recordVisit()
    }
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
      if (e.isMainFrame) patch(browserId, { hasCustomBlankContent: false })
      if (e.isMainFrame && useBrowserStore.getState().tabs[browserId]?.certError) patch(browserId, { certError: null })
    }
    const onContextMenu = (e: Electron.ContextMenuEvent) => contextMenuRef.current(wv, e)
    const onDomReady = () => {
      void browserExecJs(browserId, ANNOTATE_CTX_TRACKER_SCRIPT).catch(() => {})
      syncCanvas()
    }

    onDomReady()
    wv.addEventListener('dom-ready', onDomReady)
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
      wv.removeEventListener('dom-ready', onDomReady)
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

  const pipVisible = !previewHidden && (automationPreview || previewPinned)
  const slot = activityShown
    ? panelSlot
    : previewExpanded
      ? overlaySlot
      : pipVisible
        ? pipSlot
        : undefined
  const restingSlot = slot ?? panelSlot ?? overlaySlot ?? pipSlot
  const hasSlot = restingSlot != null && restingSlot.width > 0 && restingSlot.height > 0
  const panelCorners = panelCornersForSlot(slot, panelBounds)
  const mounted = hasSlot
  const visible = slot != null && slot.width > 0 && slot.height > 0 && !home && !certErrored
  // A screenshot transiently pulls a hidden/background tab into the viewport and
  // masks it with opacity:0 — Chromium won't rasterize a layer parked off-screen,
  // so capturePage would hang otherwise. Outside capture, hidden tabs keep their
  // cheap resting state (off-screen if slotted, so live pages don't reload during
  // mosaic/collapse; display:none if slotless) rather than always compositing,
  // which would cost GPU + un-throttled CPU for every background tab.
  const inViewport = visible || capturing
  const clipPath = visible || capturing
    ? 'inset(0 0 0 0)'
    : activitySide === 'left'
      ? 'inset(0 100% 0 0)'
      : 'inset(0 0 0 100%)'
  const width = hasSlot ? restingSlot!.width : BROWSER_FALLBACK_VIEWPORT.width
  const height = hasSlot ? restingSlot!.height : BROWSER_FALLBACK_VIEWPORT.height
  const pipViewport = resolveBrowserPipViewport(emulation, panelSlot)
  const capturingPip = fullResolutionCapturing && slot?.mode === 'pip'
  const hostWidth = capturingPip ? pipViewport.width : width
  const hostHeight = capturingPip ? pipViewport.height : height
  const webviewStyle = slot?.mode === 'pip' && !fullResolutionCapturing
    ? {
        width: pipViewport.width,
        height: pipViewport.height,
        transform: `scale(${slot.width / pipViewport.width})`,
        transformOrigin: 'left top',
      }
    : emulation
      ? { width: emulation.width, height: emulation.height }
      : { width: '100%', height: '100%' }

  // ⌘+/-/0 zooms the page under the pointer. Hover is what picks the target here,
  // the same way the chat transcript and the file preview claim these keys — and it
  // has to be the host layer that answers, not the panel content, because the
  // webview is overlaid on top of that content and takes the hover itself. The keys
  // arrive whether the host window or the guest holds focus (browser-popup-redirect).
  useEffect(() => {
    return window.app.onContentZoom((action) => {
      const wv = webviewRef.current
      if (!wv || !hostRef.current?.matches(':hover')) return
      // Electron zoom levels are exponential (factor = 1.2^level), so a half step is
      // ~10% per press — Chrome's own rhythm — and the clamp lands near 40%–250%.
      const next = action === 'reset'
        ? 0
        : action === 'in'
          ? Math.min(zoomLevelRef.current + 0.5, 5)
          : Math.max(zoomLevelRef.current - 0.5, -5)
      zoomLevelRef.current = next
      try {
        wv.setZoomLevel(next)
      } catch {
        // webview may be mid-teardown
      }
    })
  }, [])

  // Agent (and guest-page) focus must never stick on a webview the user is not
  // looking at — otherwise a background session's type/click steals the caret.
  // Visible panels keep normal click-to-focus; isolation still covers steals
  // while automation runs on a visible tab.
  useEffect(() => {
    if (visible) return
    const wv = webviewRef.current
    if (!wv) return
    const rejectFocus = () => {
      try {
        wv.blur()
      } catch {
        // webview may be mid-teardown
      }
    }
    wv.addEventListener('focus', rejectFocus)
    return () => wv.removeEventListener('focus', rejectFocus)
  }, [visible, browserId])

  return (
    <>
    <div
      ref={hostRef}
      data-browser-host=""
      data-browser-id={browserId}
      data-browser-presentation={slot?.mode ?? restingSlot?.mode}
      style={{
        position: 'absolute',
        left: inViewport ? (capturingPip ? 0 : (slot?.left ?? 0)) : -99999,
        top: inViewport ? (capturingPip ? 0 : (slot?.top ?? 0)) : 0,
        width: hostWidth,
        height: hostHeight,
        display: mounted || capturing ? 'block' : 'none',
        opacity: visible && !capturingPip ? 1 : 0,
        clipPath,
        transition: capturing
          ? 'none'
          : `clip-path ${ACTIVITY_PANEL_TRANSITION.durationMs}ms ${ACTIVITY_PANEL_TRANSITION.easing}`,
        pointerEvents: visible && slot?.mode !== 'pip' && !resizing ? 'auto' : 'none',
        overflow: 'hidden',
        // The glass window's background is transparent and Electron composites the
        // guest straight through it, so a page that paints no background of its own
        // would show the app's vibrancy. Paint the canvas Chromium would have painted
        // instead — without mutating the page. The new-tab page, drawn above this in
        // the React layer, is the one surface meant to read as glass.
        backgroundColor: home ? undefined : canvas,
        borderTopLeftRadius: slot?.mode === 'pip' ? 'var(--radius-xl)' : undefined,
        borderTopRightRadius: slot?.mode === 'pip' ? 'var(--radius-xl)' : undefined,
        borderBottomLeftRadius: slot?.mode === 'pip' || (slot?.mode === 'panel' && roundLeft && activitySide === 'left' && panelCorners.bottomLeft) ? 'var(--radius-xl)' : undefined,
        borderBottomRightRadius: slot?.mode === 'pip' || (slot?.mode === 'panel' && roundRight && activitySide === 'right' && panelCorners.bottomRight) ? 'var(--radius-xl)' : undefined,
      }}
    >
      <webview
        ref={webviewRef}
        src={initialSrcRef.current}
        partition="persist:browser"
        {...({ allowpopups: 'true' } as Record<string, string>)}
        style={webviewStyle}
      />
    </div>
    {menuNode}
    </>
  )
}
