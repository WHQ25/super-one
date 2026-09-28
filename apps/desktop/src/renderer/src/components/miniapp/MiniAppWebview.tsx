import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useMiniAppStore } from '@/stores/miniapp'
import { useBrowserStore } from '@/stores/browser'
import { isDevAppEntry } from '@superone/shared/miniapp-types'
import { clearBrowserConsole, pushBrowserConsole } from '@/components/browser/browser-host-api'
import { miniAppTargetKey, registerMiniAppTarget, type MiniAppTargetHandle, type MiniAppTargetRegistration } from './miniapp-automation-targets'

export interface MiniAppWebviewHandle {
  send(message: unknown): void
  reload(): void
  openDevTools(): void
}

interface MiniAppWebviewProps {
  appId: string
  src: string
  className?: string
  style?: React.CSSProperties
  onMessage?: (channel: string, data: Record<string, unknown>, send: (message: unknown) => void) => void
  /** Lets `browser_*` tools drive this view while the app is in development. */
  automation?: Omit<MiniAppTargetRegistration, 'appId'>
}

/** The only renderer container used for mini-app-owned HTML. */
export const MiniAppWebview = forwardRef<MiniAppWebviewHandle, MiniAppWebviewProps>(
  function MiniAppWebview({ appId, src, className, style, onMessage, automation }, ref) {
    const elementRef = useRef<Electron.WebviewTag>(null)
    const targetRef = useRef<MiniAppTargetHandle | null>(null)
    const isDevApp = useMiniAppStore((s) => s.apps.some((app) => app.id === appId && isDevAppEntry(app)))
    const [preloadPath, setPreloadPath] = useState<string | null>(null)
    // `webview.send()` rejects until the guest reaches dom-ready. A MiniApp Host
    // can post to its WebView from `activate()`, long before the page loads, so
    // queue instead of dropping the message into an unhandled rejection.
    const domReadyRef = useRef(false)
    const queueRef = useRef<unknown[]>([])

    useEffect(() => {
      window.miniapp.getPreloadPath().then(setPreloadPath)
    }, [])

    const deliver = useCallback((message: unknown) => {
      const data = message as Record<string, unknown>
      if (typeof data?.type !== 'string') return
      elementRef.current?.send(data.type, data).catch(() => { /* guest went away */ })
    }, [])

    const send = useCallback((message: unknown) => {
      if (!domReadyRef.current) {
        queueRef.current.push(message)
        return
      }
      deliver(message)
    }, [deliver])

    useImperativeHandle(ref, () => ({
      send,
      reload: () => elementRef.current?.reload(),
      openDevTools: () => elementRef.current?.openDevTools(),
    }), [send])

    useEffect(() => {
      const element = elementRef.current
      if (!element) return
      const handleIpcMessage = (event: Electron.IpcMessageEvent) => {
        onMessage?.(event.channel, (event.args[0] ?? {}) as Record<string, unknown>, send)
      }
      const handleDomReady = () => {
        domReadyRef.current = true
        targetRef.current?.setReady(true)
        const queued = queueRef.current.splice(0)
        for (const message of queued) deliver(message)
      }
      // A reload or in-app navigation tears the guest frame down; anything sent
      // before the next dom-ready would be lost, so re-arm the queue.
      const handleStartLoading = () => {
        domReadyRef.current = false
        targetRef.current?.setReady(false)
      }
      const suppressContextMenu = (event: Event) => event.preventDefault()
      element.addEventListener('ipc-message', handleIpcMessage)
      element.addEventListener('dom-ready', handleDomReady)
      element.addEventListener('did-start-loading', handleStartLoading)
      element.addEventListener('context-menu', suppressContextMenu)
      return () => {
        element.removeEventListener('ipc-message', handleIpcMessage)
        element.removeEventListener('dom-ready', handleDomReady)
        element.removeEventListener('did-start-loading', handleStartLoading)
        element.removeEventListener('context-menu', suppressContextMenu)
      }
    }, [deliver, onMessage, preloadPath, send])

    const targetId = automation?.targetId
    const targetProjectDir = automation?.projectDir
    const targetKind = automation?.kind
    const targetTitle = automation?.title
    // Viewport emulation (browser_emulate) sizes the element to the emulated viewport,
    // as it does a browser tab, so the pixels shown match the page's layout.
    const emulation = useBrowserStore((s) => (
      isDevApp && targetId && targetProjectDir ? s.emulations[miniAppTargetKey(targetId, targetProjectDir)] : undefined
    ))
    useEffect(() => {
      const element = elementRef.current
      if (!element || !isDevApp || !targetId || !targetProjectDir || !targetKind) return
      const target = registerMiniAppTarget(
        { targetId, appId, projectDir: targetProjectDir, kind: targetKind, title: targetTitle ?? appId },
        element,
      )
      target.setReady(domReadyRef.current)
      targetRef.current = target
      const handleConsole = (event: Electron.ConsoleMessageEvent) => pushBrowserConsole(target.key, event.level, event.message)
      const handleNavigation = (event: Electron.DidStartNavigationEvent) => {
        if (event.isMainFrame) clearBrowserConsole(target.key)
      }
      const handleFailLoad = (event: Electron.DidFailLoadEvent) => {
        if (event.isMainFrame && event.errorCode !== -3) pushBrowserConsole(target.key, 'error', `Failed to load ${event.validatedURL}: ${event.errorDescription}`)
      }
      const handleCrash = (event: Electron.RenderProcessGoneEvent) => {
        pushBrowserConsole(target.key, 'error', `WebView renderer process gone: ${event.details.reason}`)
      }
      element.addEventListener('console-message', handleConsole)
      element.addEventListener('did-start-navigation', handleNavigation)
      element.addEventListener('did-fail-load', handleFailLoad)
      element.addEventListener('render-process-gone', handleCrash)
      return () => {
        element.removeEventListener('console-message', handleConsole)
        element.removeEventListener('did-start-navigation', handleNavigation)
        element.removeEventListener('did-fail-load', handleFailLoad)
        element.removeEventListener('render-process-gone', handleCrash)
        if (targetRef.current === target) targetRef.current = null
        target.dispose()
      }
    }, [appId, isDevApp, preloadPath, targetId, targetKind, targetProjectDir, targetTitle])

    if (!preloadPath) return null

    return (
      <webview
        ref={elementRef}
        src={src}
        preload={`file://${preloadPath}`}
        partition={`persist:miniapp-${appId}`}
        className={className}
        style={emulation ? { ...style, width: emulation.width, height: emulation.height } : style}
      />
    )
  },
)
