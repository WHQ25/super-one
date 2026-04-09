import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useIsDark } from '@/hooks/use-is-dark'
import { readThemeVars } from './miniapp-theme'
import { handleMiniAppMessage } from '@/hooks/miniapp-message-handler'

export interface MiniAppDevFrameHandle {
  reload: () => void
  openDevTools: () => void
}

interface MiniAppDevFrameProps {
  appId: string
  className?: string
}

export const MiniAppDevFrame = forwardRef<MiniAppDevFrameHandle, MiniAppDevFrameProps>(
  function MiniAppDevFrame({ appId, className }, ref) {
    const webviewRef = useRef<Electron.WebviewTag>(null)
    const isDark = useIsDark()
    const isDarkRef = useRef(isDark)
    isDarkRef.current = isDark
    const readyRef = useRef(false)
    const [preloadPath, setPreloadPath] = useState<string | null>(null)

    useEffect(() => {
      window.miniapp.getPreloadPath().then(setPreloadPath)
    }, [])

    const reload = useCallback(() => {
      webviewRef.current?.reload()
    }, [])

    const openDevTools = useCallback(() => {
      webviewRef.current?.openDevTools()
    }, [])

    useImperativeHandle(ref, () => ({ reload, openDevTools }), [reload, openDevTools])

    useEffect(() => {
      const wv = webviewRef.current
      if (!wv) return

      const wvSend = (msg: unknown) => { const m = msg as Record<string, unknown>; wv.send(m.type as string, m) }

      const handleIpcMessage = (event: Electron.IpcMessageEvent) => {
        const { channel, args } = event
        const data = args[0] as Record<string, unknown>

        if (handleMiniAppMessage(channel, data, appId, wvSend)) return

        switch (channel) {
          case 'miniapp-ready':
            readyRef.current = true
            window.miniapp.iframeReady(appId)
            wv.send('miniapp-theme', { vars: readThemeVars(), isDark: isDarkRef.current })
            break
        }
      }

      wv.addEventListener('ipc-message', handleIpcMessage)
      return () => { wv.removeEventListener('ipc-message', handleIpcMessage) }
    }, [appId, preloadPath])

    useEffect(() => {
      if (!readyRef.current) return
      webviewRef.current?.send('miniapp-theme', { vars: readThemeVars(), isDark })
    }, [isDark])

    useEffect(() => {
      const cleanup = window.miniapp.onGitHeadChangeEvent((event) => {
        if (event.appId !== appId) return
        webviewRef.current?.send('miniapp-git-head-change', {})
      })
      return cleanup
    }, [appId])

    useEffect(() => {
      const cleanup = window.miniapp.onFsWatchEvent((event) => {
        if (event.appId !== appId) return
        webviewRef.current?.send('miniapp-fs-watch-event', {
          watchId: event.watchId,
          eventType: event.type,
          path: event.path,
        })
      })
      return cleanup
    }, [appId])

    useEffect(() => {
      const cleanup = window.miniapp.onToolCall((call) => {
        if (call.appId !== appId) return
        webviewRef.current?.send('miniapp-tool-call', {
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments,
        })
      })
      return cleanup
    }, [appId])

    if (!preloadPath) return null

    return (
      <div className={className} style={{ position: 'relative', minWidth: 0 }}>
        <webview
          ref={webviewRef}
          src={`superone-app://${appId}/index.html`}
          preload={`file://${preloadPath}`}
          style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
        />
      </div>
    )
  },
)
