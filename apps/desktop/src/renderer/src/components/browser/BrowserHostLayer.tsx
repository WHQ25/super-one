import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useBrowserStore } from '@/stores/browser'
import { useAppStore } from '@/stores/app'
import { registerBrowserWebview, browserExecJs } from './browser-host-api'
import { buildSessionScript, handleAnnotationMessage } from './browser-annotate-flow'
import { ANNOTATE_CANCEL_SCRIPT, ANNOTATE_MSG_PREFIX } from './browser-annotate-script'

export function BrowserHostLayer() {
  const ids = useBrowserStore(useShallow((s) => Object.keys(s.tabs)))
  const layoutMode = useAppStore((s) => s.layoutMode)

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {ids.map((id) => (
        <PersistentBrowser key={id} browserId={id} layoutMode={layoutMode} />
      ))}
    </div>
  )
}

function PersistentBrowser({ browserId, layoutMode }: { browserId: string; layoutMode: 'canvas' | 'coding' }) {
  const slot = useBrowserStore((s) => s.slots[browserId])
  const annotating = useBrowserStore((s) => s.annotatingId === browserId)
  const webviewRef = useRef<Electron.WebviewTag>(null)
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

    const syncNav = () => patch(browserId, { url: wv.getURL(), canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })
    const onStart = () => patch(browserId, { loading: true })
    const onStop = () => { patch(browserId, { loading: false }); syncNav() }
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => patch(browserId, { title: e.title })
    const onFavicon = (e: Electron.PageFaviconUpdatedEvent) => patch(browserId, { favicon: e.favicons[0] ?? null })
    const onNavigate = () => syncNav()
    const onFail = (e: Electron.DidFailLoadEvent) => { if (e.errorCode !== -3) patch(browserId, { loading: false }) }

    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('page-favicon-updated', onFavicon)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      unregister()
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
  const visible = presentationMatches && slot != null && slot.width > 0 && slot.height > 0

  return (
    <div
      data-browser-host=""
      data-browser-id={browserId}
      style={{
        position: 'absolute',
        left: visible ? slot!.left : -99999,
        top: slot?.top ?? 0,
        width: slot?.width ?? 0,
        height: slot?.height ?? 0,
        display: visible ? 'block' : 'none',
        pointerEvents: visible ? 'auto' : 'none',
        overflow: 'hidden',
      }}
    >
      <webview
        ref={webviewRef}
        src={initialSrcRef.current}
        partition="persist:browser"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
