import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useChatStore } from '@/stores/chat'
import type { MiniAppToolCallRequest } from '../../../../shared/miniapp-types'

interface MiniAppFrameProps {
  appId: string
  className?: string
}

export const MiniAppFrame = forwardRef<HTMLIFrameElement, MiniAppFrameProps>(
  function MiniAppFrame({ appId, className }, ref) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  useImperativeHandle(ref, () => iframeRef.current!, [])

  const handlePostMessage = useCallback(
    (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const data = e.data
      if (!data?.type) return

      switch (data.type) {
        case 'miniapp-tool-result':
          window.miniapp.toolResult(data.callId, data.result, data.error)
          break
        case 'miniapp-sendPrompt':
          if (typeof data.text === 'string') {
            useChatStore.getState().setDraftText(data.text)
          }
          break
        case 'miniapp-fs-request':
          window.miniapp
            .fsRequest(data.appId, data.op, data.args)
            .then((result) => {
              iframeRef.current?.contentWindow?.postMessage(
                { type: 'miniapp-fs-response', id: data.id, result },
                '*',
              )
            })
            .catch((err) => {
              iframeRef.current?.contentWindow?.postMessage(
                { type: 'miniapp-fs-response', id: data.id, error: err.message },
                '*',
              )
            })
          break
        case 'miniapp-ready':
          window.miniapp.iframeReady(appId)
          break
      }
    },
    [appId],
  )

  useEffect(() => {
    window.addEventListener('message', handlePostMessage)
    return () => window.removeEventListener('message', handlePostMessage)
  }, [handlePostMessage])

  useEffect(() => {
    const cleanup = window.miniapp.onToolCall((call: MiniAppToolCallRequest) => {
      if (call.appId !== appId) return
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: 'miniapp-tool-call',
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments,
        },
        '*',
      )
    })
    return cleanup
  }, [appId])

  return (
    <iframe
      ref={iframeRef}
      src={`superone-app://${appId}/index.html`}
      sandbox="allow-scripts"
      className={className}
      style={{ border: 'none', width: '100%', height: '100%' }}
    />
  )
})
