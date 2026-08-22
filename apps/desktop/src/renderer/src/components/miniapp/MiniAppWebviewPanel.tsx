import { useEffect, useRef, useCallback, useImperativeHandle, useMemo, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDark } from '@/hooks/use-is-dark'
import { onThemeChange, readThemeVars } from './miniapp-theme'
import { handleMiniAppMessage, type MiniAppOverlayCallbacks } from '@/hooks/miniapp-message-handler'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppMediaStore } from '@/stores/miniapp-media'
import { buildMiniAppUrlHost } from '@superone/shared/miniapp-url'
import { MiniAppWebview, type MiniAppWebviewHandle } from './MiniAppWebview'

export interface MiniAppWebviewPanelHandle {
  reload: () => void
  openDevTools: () => void
}

interface MiniAppWebviewPanelProps {
  instanceKey: string
  appId: string
  projectDir: string
  className?: string
  overlay?: MiniAppOverlayCallbacks
}

export const MiniAppWebviewPanel = forwardRef<MiniAppWebviewPanelHandle, MiniAppWebviewPanelProps>(
  function MiniAppWebviewPanel({ instanceKey, appId, projectDir, className, overlay }, ref) {
    const webviewRef = useRef<MiniAppWebviewHandle>(null)
    const isDark = useIsDark()
    const isDarkRef = useRef(isDark)
    isDarkRef.current = isDark
    const { i18n } = useTranslation()
    const locale = i18n.language
    const initialLocaleRef = useRef(locale)
    const readyRef = useRef(false)
    const projectId = useMiniAppStore((s) => s.openApps[instanceKey]?.projectId ?? null)
    const src = useMemo(
      () => `superone-app://${buildMiniAppUrlHost(appId, projectId)}/index.html?_locale=${encodeURIComponent(initialLocaleRef.current)}`,
      [appId, projectId],
    )

    // A live MediaStreamTrack may outlive its WebView, so clear the host
    // recording indicator when the app panel unmounts.
    useEffect(() => {
      return () => useMiniAppMediaStore.getState().clearApp(appId)
    }, [appId])

    const reload = useCallback(() => {
      webviewRef.current?.reload()
    }, [])

    const openDevTools = useCallback(() => {
      webviewRef.current?.openDevTools()
    }, [])

    useImperativeHandle(ref, () => ({ reload, openDevTools }), [reload, openDevTools])

    const sendToWebview = useCallback((msg: unknown) => {
      webviewRef.current?.send(msg)
    }, [])

    const handleIpcMessage = useCallback((channel: string, data: Record<string, unknown>, send: (message: unknown) => void) => {
      if (handleMiniAppMessage(channel, data, appId, projectDir, send, overlay)) return
      if (channel === 'miniapp-ready') {
        readyRef.current = true
        send({ type: 'miniapp-theme', vars: readThemeVars(), isDark: isDarkRef.current })
      }
    }, [appId, projectDir, overlay])

    useEffect(() => {
      if (!readyRef.current) return
      sendToWebview({ type: 'miniapp-theme', vars: readThemeVars(), isDark })
    }, [isDark, sendToWebview])

    useEffect(() => {
      return onThemeChange(() => {
        if (!readyRef.current) return
        sendToWebview({ type: 'miniapp-theme', vars: readThemeVars(), isDark: isDarkRef.current })
      })
    }, [sendToWebview])

    useEffect(() => {
      if (!readyRef.current) return
      sendToWebview({ type: 'miniapp-locale', locale })
    }, [locale, sendToWebview])

    useEffect(() => {
      return window.miniapp.onHostMessage((data) => {
        if (data.appId !== appId || data.projectDir !== projectDir) return
        sendToWebview({ type: 'miniapp-node-message', payload: data.payload })
      })
    }, [appId, projectDir, sendToWebview])


    return (
      <div className={className} style={{ position: 'relative', minWidth: 0 }}>
        <MiniAppWebview
          ref={webviewRef}
          appId={appId}
          src={src}
          onMessage={handleIpcMessage}
          style={{ position: 'absolute', inset: 0, border: 'none', width: '100%', height: '100%' }}
        />
      </div>
    )
  },
)
