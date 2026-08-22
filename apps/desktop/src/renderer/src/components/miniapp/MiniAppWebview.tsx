import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

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
}

/** The only renderer container used for mini-app-owned HTML. */
export const MiniAppWebview = forwardRef<MiniAppWebviewHandle, MiniAppWebviewProps>(
  function MiniAppWebview({ appId, src, className, style, onMessage }, ref) {
    const elementRef = useRef<Electron.WebviewTag>(null)
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
        const queued = queueRef.current.splice(0)
        for (const message of queued) deliver(message)
      }
      // A reload or in-app navigation tears the guest frame down; anything sent
      // before the next dom-ready would be lost, so re-arm the queue.
      const handleStartLoading = () => { domReadyRef.current = false }
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

    if (!preloadPath) return null

    return (
      <webview
        ref={elementRef}
        src={src}
        preload={`file://${preloadPath}`}
        partition={`persist:miniapp-${appId}`}
        className={className}
        style={style}
      />
    )
  },
)
