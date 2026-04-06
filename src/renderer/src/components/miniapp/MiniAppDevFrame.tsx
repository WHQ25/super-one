import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useChatStore } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import { readThemeVars } from './miniapp-theme'

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

      const handleIpcMessage = (event: Electron.IpcMessageEvent) => {
        const { channel, args } = event
        const data = args[0] as Record<string, unknown>

        switch (channel) {
          case 'miniapp-tool-result':
            window.miniapp.toolResult(
              data.callId as string,
              data.result,
              data.error as string | undefined,
            )
            break
          case 'miniapp-sendPrompt':
            if (typeof data.text === 'string') {
              useChatStore.getState().setDraftText(data.text)
            }
            break
          case 'miniapp-fs-request':
            window.miniapp
              .fsRequest(appId, data.op as string, data.args as Record<string, unknown>)
              .then((result) => {
                wv.send('miniapp-fs-response', { id: data.id, result })
              })
              .catch((err: Error) => {
                wv.send('miniapp-fs-response', { id: data.id, error: err.message })
              })
            break
          case 'miniapp-git-request':
            window.miniapp
              .gitRequest(appId, data.op as string, data.args as Record<string, unknown>)
              .then((result) => {
                wv.send('miniapp-git-response', { id: data.id, result })
              })
              .catch((err: Error) => {
                wv.send('miniapp-git-response', { id: data.id, error: err.message })
              })
            break
          case 'miniapp-fs-watch':
            window.miniapp
              .fsWatch(appId, data.path as string)
              .then((watchId) => {
                wv.send('miniapp-fs-watch-ack', { id: data.id, watchId })
              })
              .catch((err: Error) => {
                wv.send('miniapp-fs-watch-ack', { id: data.id, error: err.message })
              })
            break
          case 'miniapp-fs-unwatch':
            window.miniapp.fsUnwatch(data.watchId as number)
            break
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
      <webview
        ref={webviewRef}
        src={`superone-app://${appId}/index.html`}
        preload={`file://${preloadPath}`}
        className={className}
        style={{ border: 'none', width: '100%', height: '100%' }}
      />
    )
  },
)
