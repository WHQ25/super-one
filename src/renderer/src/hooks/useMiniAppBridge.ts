import { useEffect, useRef, useCallback, type RefObject } from 'react'
import { useChatStore } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import { readThemeVars } from '@/components/miniapp/miniapp-theme'
import type { MiniAppToolCallRequest } from '../../../shared/miniapp-types'

export interface MiniAppBridgeOptions {
  appId: string
  iframeRef: RefObject<HTMLIFrameElement | null>
  onReady?: () => void
  onResize?: (height: number) => void
  inChatMode?: boolean
}

export function useMiniAppBridge({ appId, iframeRef, onReady, onResize, inChatMode }: MiniAppBridgeOptions) {
  const isDark = useIsDark()
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark
  const readyRef = useRef(false)

  const sendToFrame = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [iframeRef])

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
              sendToFrame({ type: 'miniapp-fs-response', id: data.id, result })
            })
            .catch((err) => {
              sendToFrame({ type: 'miniapp-fs-response', id: data.id, error: err.message })
            })
          break
        case 'miniapp-git-request':
          window.miniapp
            .gitRequest(appId, data.op as string, data.args as Record<string, unknown>)
            .then((result) => {
              sendToFrame({ type: 'miniapp-git-response', id: data.id, result })
            })
            .catch((err) => {
              sendToFrame({ type: 'miniapp-git-response', id: data.id, error: err.message })
            })
          break
        case 'miniapp-fs-watch':
          window.miniapp
            .fsWatch(appId, data.path)
            .then((watchId) => {
              sendToFrame({ type: 'miniapp-fs-watch-ack', id: data.id, watchId })
            })
            .catch((err) => {
              sendToFrame({ type: 'miniapp-fs-watch-ack', id: data.id, error: err.message })
            })
          break
        case 'miniapp-fs-unwatch':
          window.miniapp.fsUnwatch(data.watchId)
          break
        case 'miniapp-resize':
          if (typeof data.height === 'number' && data.height > 0) {
            onResize?.(data.height)
          }
          break
        case 'miniapp-ready':
          readyRef.current = true
          window.miniapp.iframeReady(appId)
          sendToFrame({ type: 'miniapp-theme', vars: readThemeVars(), isDark: isDarkRef.current })
          onReady?.()
          break
      }
    },
    [appId, sendToFrame, onReady, onResize, iframeRef],
  )

  useEffect(() => {
    window.addEventListener('message', handlePostMessage)
    return () => window.removeEventListener('message', handlePostMessage)
  }, [handlePostMessage])

  useEffect(() => {
    if (!readyRef.current) return
    sendToFrame({ type: 'miniapp-theme', vars: readThemeVars(), isDark })
  }, [isDark, sendToFrame])

  useEffect(() => {
    if (inChatMode) return
    const cleanup = window.miniapp.onGitHeadChangeEvent((event) => {
      if (event.appId !== appId) return
      sendToFrame({ type: 'miniapp-git-head-change' })
    })
    return cleanup
  }, [appId, sendToFrame, inChatMode])

  useEffect(() => {
    if (inChatMode) return
    const cleanup = window.miniapp.onFsWatchEvent((event) => {
      if (event.appId !== appId) return
      sendToFrame({ type: 'miniapp-fs-watch-event', watchId: event.watchId, eventType: event.type, path: event.path })
    })
    return cleanup
  }, [appId, sendToFrame, inChatMode])

  useEffect(() => {
    if (inChatMode) return
    const cleanup = window.miniapp.onToolCall((call: MiniAppToolCallRequest) => {
      if (call.appId !== appId) return
      sendToFrame({
        type: 'miniapp-tool-call',
        callId: call.callId,
        toolName: call.toolName,
        arguments: call.arguments,
      })
    })
    return cleanup
  }, [appId, sendToFrame, inChatMode])

  return { sendToFrame, readyRef }
}
