import { useEffect, useRef, useState, useCallback, useImperativeHandle, useMemo, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDark } from '@/hooks/use-is-dark'
import { onThemeChange, readThemeVars } from './miniapp-theme'
import { handleMiniAppMessage, type MiniAppOverlayCallbacks } from '@/hooks/miniapp-message-handler'
import { useContextConsumedEvent } from '@/hooks/useContextConsumedEvent'
import { useMiniAppStore } from '@/stores/miniapp'
import { buildMiniAppHost } from '@superone/shared/miniapp-host'

export interface MiniAppDevFrameHandle {
  reload: () => void
  openDevTools: () => void
}

interface MiniAppDevFrameProps {
  instanceKey: string
  appId: string
  projectDir: string
  className?: string
  overlay?: MiniAppOverlayCallbacks
}

export const MiniAppDevFrame = forwardRef<MiniAppDevFrameHandle, MiniAppDevFrameProps>(
  function MiniAppDevFrame({ instanceKey, appId, projectDir, className, overlay }, ref) {
    const webviewRef = useRef<Electron.WebviewTag>(null)
    const isDark = useIsDark()
    const isDarkRef = useRef(isDark)
    isDarkRef.current = isDark
    const { i18n } = useTranslation()
    const locale = i18n.language
    const initialLocaleRef = useRef(locale)
    const readyRef = useRef(false)
    const [preloadPath, setPreloadPath] = useState<string | null>(null)
    const projectId = useMiniAppStore((s) => s.openApps[instanceKey]?.projectId ?? null)
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

        if (handleMiniAppMessage(channel, data, appId, projectDir, wvSend, overlay)) return

        switch (channel) {
          case 'miniapp-ready':
            readyRef.current = true
            window.miniapp.iframeReady(appId, projectDir)
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
    }, [appId, projectDir, preloadPath, overlay])

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
      window.app.trace?.('miniapp.toolcall', 'devframe-subscribe', { appId, projectDir })
      const cleanup = window.miniapp.onToolCall((call) => {
        const match = call.appId === appId && call.projectDir === projectDir
        window.app.trace?.('miniapp.toolcall', 'devframe-received', { callId: call.callId, toolName: call.toolName, incoming: { appId: call.appId, projectDir: call.projectDir }, own: { appId, projectDir }, match, webviewMounted: !!webviewRef.current })
        if (!match) return
        // Standalone tools are owned by the chat block iframe, not the panel webview.
        const app = useMiniAppStore.getState().apps.find((a) => a.id === appId)
        const toolDef = app?.manifest.tools?.find((t) => t.name === call.toolName)
        if (toolDef?.standalone) return
        webviewRef.current?.send('miniapp-tool-call', {
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments,
          projectDir: call.projectDir,
        })
        window.app.trace?.('miniapp.toolcall', 'devframe-forwarded', { callId: call.callId, toolName: call.toolName })
      })
      return cleanup
    }, [appId, projectDir])

    useEffect(() => {
      window.app.trace?.('miniapp.peer', 'devframe-subscribe', { appId })
      const cleanup = window.miniapp.onPeerEvent((evt) => {
        const match = evt.appId === appId
        window.app.trace?.('miniapp.peer', 'devframe-received', { incomingAppId: evt.appId, ownAppId: appId, event: evt.event, match })
        if (!match) return
        webviewRef.current?.send('miniapp-peer-event', { appId: evt.appId, event: evt.event, payload: evt.payload })
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
