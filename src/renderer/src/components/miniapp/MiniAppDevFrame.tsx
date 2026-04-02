import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { useChatStore } from '@/stores/chat'

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
          case 'miniapp-ready':
            window.miniapp.iframeReady(appId)
            break
        }
      }

      wv.addEventListener('ipc-message', handleIpcMessage)
      return () => { wv.removeEventListener('ipc-message', handleIpcMessage) }
    }, [appId, preloadPath])

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
