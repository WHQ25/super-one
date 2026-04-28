import { useEffect, useRef, useCallback, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDark } from '@/hooks/use-is-dark'
import { onThemeChange, readThemeVars } from '@/components/miniapp/miniapp-theme'
import { handleMiniAppMessage, type MiniAppOverlayCallbacks } from '@/hooks/miniapp-message-handler'
import { useContextConsumedEvent } from '@/hooks/useContextConsumedEvent'
import type { MiniAppToolCallRequest } from '../../../shared/miniapp-types'

export interface MiniAppBridgeOptions {
  appId: string
  iframeRef: RefObject<HTMLIFrameElement | null>
  onReady?: () => void
  onResize?: (height: number) => void
  inChatMode?: boolean
  overlay?: MiniAppOverlayCallbacks
}

export function useMiniAppBridge({ appId, iframeRef, onReady, onResize, inChatMode, overlay }: MiniAppBridgeOptions) {
  const isDark = useIsDark()
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark
  const { i18n } = useTranslation()
  const locale = i18n.language
  const readyRef = useRef(false)

  const sendToFrame = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }, [iframeRef])

  const handlePostMessage = useCallback(
    (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const data = e.data
      if (!data?.type) return

      if (handleMiniAppMessage(data.type, data, appId, sendToFrame, overlay)) return

      switch (data.type) {
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
    [appId, sendToFrame, onReady, onResize, iframeRef, overlay],
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
    return onThemeChange(() => {
      if (!readyRef.current) return
      sendToFrame({ type: 'miniapp-theme', vars: readThemeVars(), isDark: isDarkRef.current })
    })
  }, [sendToFrame])

  useEffect(() => {
    if (!readyRef.current) return
    sendToFrame({ type: 'miniapp-locale', locale })
  }, [locale, sendToFrame])

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

  useContextConsumedEvent(appId, sendToFrame, inChatMode)

  useEffect(() => {
    if (inChatMode) return
    const cleanup = window.miniapp.onToolCall((call: MiniAppToolCallRequest) => {
      if (call.appId !== appId) return
      window.app.trace?.('miniapp.tool', 'forward_to_iframe', { appId, toolName: call.toolName }, call.callId)
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
