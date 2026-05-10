import { useEffect, useRef, useState, useCallback, useImperativeHandle, useMemo, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDark } from '@/hooks/use-is-dark'
import { onThemeChange, readThemeVars } from './miniapp-theme'
import { handleMiniAppMessage, type MiniAppOverlayCallbacks } from '@/hooks/miniapp-message-handler'
import { useContextConsumedEvent } from '@/hooks/useContextConsumedEvent'
import { useAppStore } from '@/stores/app'
import { buildMiniAppHost } from '@superone/shared/miniapp-host'

export interface MiniAppDevFrameHandle {
  reload: () => void
  openDevTools: () => void
}

interface MiniAppDevFrameProps {
  appId: string
  className?: string
  overlay?: MiniAppOverlayCallbacks
}

export const MiniAppDevFrame = forwardRef<MiniAppDevFrameHandle, MiniAppDevFrameProps>(
  function MiniAppDevFrame({ appId, className, overlay }, ref) {
    const webviewRef = useRef<Electron.WebviewTag>(null)
    const isDark = useIsDark()
    const isDarkRef = useRef(isDark)
    isDarkRef.current = isDark
    const { i18n } = useTranslation()
    const locale = i18n.language
    const initialLocaleRef = useRef(locale)
    const readyRef = useRef(false)
    const [preloadPath, setPreloadPath] = useState<string | null>(null)
    const projectId = useAppStore((s) => s.currentProjectId)
    const src = useMemo(
      () => `superone-app://${buildMiniAppHost(appId, projectId)}/index.html?_locale=${encodeURIComponent(initialLocaleRef.current)}`,
      [appId, projectId],
    )

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

    const sendToWebview = useCallback((msg: unknown) => {
      const m = msg as Record<string, unknown>
      webviewRef.current?.send(m.type as string, m)
    }, [])

    useEffect(() => {
      const wv = webviewRef.current
      if (!wv) return

      const wvSend = (msg: unknown) => { const m = msg as Record<string, unknown>; wv.send(m.type as string, m) }

      const handleIpcMessage = (event: Electron.IpcMessageEvent) => {
        const { channel, args } = event
        const data = args[0] as Record<string, unknown>

        if (handleMiniAppMessage(channel, data, appId, wvSend, overlay)) return

        switch (channel) {
          case 'miniapp-ready':
            readyRef.current = true
            window.miniapp.iframeReady(appId)
            wv.send('miniapp-theme', { vars: readThemeVars(), isDark: isDarkRef.current })
            break
        }
      }

      const suppressContextMenu = (e: Event) => { e.preventDefault() }

      wv.addEventListener('ipc-message', handleIpcMessage)
      wv.addEventListener('context-menu', suppressContextMenu)
      return () => {
        wv.removeEventListener('ipc-message', handleIpcMessage)
        wv.removeEventListener('context-menu', suppressContextMenu)
      }
    }, [appId, preloadPath, overlay])

    useEffect(() => {
      if (!readyRef.current) return
      webviewRef.current?.send('miniapp-theme', { vars: readThemeVars(), isDark })
    }, [isDark])

    useEffect(() => {
      return onThemeChange(() => {
        if (!readyRef.current) return
        webviewRef.current?.send('miniapp-theme', { vars: readThemeVars(), isDark: isDarkRef.current })
      })
    }, [])

    useEffect(() => {
      if (!readyRef.current) return
      webviewRef.current?.send('miniapp-locale', { locale })
    }, [locale])

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

    useContextConsumedEvent(appId, sendToWebview)

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
          src={src}
          preload={`file://${preloadPath}`}
          style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
        />
      </div>
    )
  },
)
