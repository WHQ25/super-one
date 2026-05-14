import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { buildStandaloneToolUrl } from '@superone/shared/miniapp-types'
import { buildMiniAppHost } from '@superone/shared/miniapp-host'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { cn } from '@superone/ui/lib/utils'
import { handleMiniAppMessage } from '@/hooks/miniapp-message-handler'

const DEFAULT_HEIGHT = 80
const PLACEHOLDER_MIN_HEIGHT = 60
const VIEWPORT_ROOT_MARGIN = '400px'

interface Props {
  appId: string
  toolUseId: string
  toolName: string
  appName: string
  toolReadableName: string
  args: Record<string, unknown>
  result?: string
  isStreaming: boolean
  templatePath: string
}

/**
 * Standalone tool block — owns one iframe per tool call. The iframe both executes the
 * author's `superone.tools.handle(...)` registration and renders the tool's chat-block UI.
 *
 * MCP server's callId (randomUUID, awaited in main's pending map) is distinct from the SDK
 * toolUseId (in the chat tool_use block). useStandaloneToolCallRouter populates
 * _pendingStandaloneCalls[toolUseId] = { callId, ... } once the IPC arrives. This block
 * subscribes by toolUseId; iframe dispatch + tool-result reply use entry.callId so main's
 * pending map can match.
 */
export function StandaloneToolBlock(props: Props) {
  const { appId, toolUseId, toolName, appName, toolReadableName, args, result, isStreaming, templatePath } = props

  const projectId = useAppStore((s) => s.currentProjectId)
  const projectDir = useAppStore((s) => s.currentFolder)
  const callEntry = useChatStore((s) => s._pendingStandaloneCalls[toolUseId])

  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const dispatchedRef = useRef(false)

  const [iframeReady, setIframeReady] = useState(false)
  const [inViewport, setInViewport] = useState(true)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  const host = projectId ? buildMiniAppHost(appId, projectId) : buildMiniAppHost(appId, null)
  const src = useMemo(
    () => buildStandaloneToolUrl(host, toolUseId, toolName, templatePath),
    [host, toolUseId, toolName, templatePath],
  )

  const cachedResult = useMemo(() => {
    if (!result || isStreaming) return null
    try { return JSON.parse(result) } catch { return result }
  }, [result, isStreaming])

  function postToIframe(msg: unknown) {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(msg, '*')
  }

  function maybeDispatch() {
    if (!iframeReady) {
      window.app.trace?.('miniapp.standalone', 'block-maybedispatch', {
        toolUseId, decision: 'not-ready', hasEntry: !!callEntry, hasCachedResult: cachedResult !== null, inViewport,
      }, callEntry?.callId)
      return
    }
    if (dispatchedRef.current) {
      window.app.trace?.('miniapp.standalone', 'block-maybedispatch', {
        toolUseId, decision: 'already-dispatched',
      }, callEntry?.callId)
      return
    }
    if (cachedResult !== null && !isStreaming) {
      const replyCallId = callEntry?.callId ?? toolUseId
      window.app.trace?.('miniapp.standalone', 'block-maybedispatch', {
        toolUseId, decision: 'dispatch-cached', callId: replyCallId,
      }, replyCallId)
      postToIframe({ type: 'miniapp-standalone-cached-result', callId: replyCallId, arguments: args, result: cachedResult })
      dispatchedRef.current = true
      return
    }
    if (callEntry) {
      window.app.trace?.('miniapp.standalone', 'block-maybedispatch', {
        toolUseId, decision: 'dispatch-call', callId: callEntry.callId, toolName,
      }, callEntry.callId)
      postToIframe({
        type: 'miniapp-standalone-call',
        callId: callEntry.callId,
        toolName,
        arguments: callEntry.arguments,
      })
      dispatchedRef.current = true
    } else {
      window.app.trace?.('miniapp.standalone', 'block-maybedispatch', {
        toolUseId, decision: 'wait-for-entry',
      })
    }
  }

  useEffect(() => {
    window.app.trace?.('miniapp.standalone', 'block-mount', {
      toolUseId, appId, toolName, isStreaming, hasResult: !!result,
    })
    return () => {
      window.app.trace?.('miniapp.standalone', 'block-unmount', { toolUseId, appId, toolName })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolUseId, appId, toolName])

  useEffect(() => {
    window.app.trace?.('miniapp.standalone', 'block-call-entry', {
      toolUseId, hasEntry: !!callEntry, callId: callEntry?.callId, hasCachedResult: cachedResult !== null, iframeReady,
    }, callEntry?.callId)
    maybeDispatch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callEntry, cachedResult, iframeReady])

  // postMessage listener: standalone-specific (ready/resize) + delegate fs/kv/git/db/ui/
  // tool-result to the shared handler so the iframe's superone.* requests reach main
  // exactly like a panel iframe would.
  useEffect(() => {
    if (!inViewport) return
    const onMessage = (ev: MessageEvent) => {
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return
      const data = ev.data as Record<string, unknown> & { type?: string; height?: number }
      if (!data || typeof data.type !== 'string') return

      if (data.type === 'miniapp-ready') {
        window.app.trace?.('miniapp.standalone', 'block-iframe-ready', {
          toolUseId, appId, toolName,
        })
        setIframeReady(true)
        return
      }
      if (data.type === 'miniapp-resize' && typeof data.height === 'number' && data.height > 0) {
        setHeight(Math.max(data.height, PLACEHOLDER_MIN_HEIGHT))
        return
      }
      if (projectDir) {
        handleMiniAppMessage(data.type, data, appId, projectDir, postToIframe)
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inViewport, toolUseId, appId, projectDir])

  // Reset iframe-ready when the iframe is recreated (inViewport flips back to true
  // mounts a fresh iframe; reuse of the old `iframeReady=true` would skip the
  // load wait). Cleanup only fires when inViewport=false → iframe is unmounted.
  useEffect(() => {
    if (!inViewport) {
      setIframeReady(false)
      dispatchedRef.current = false
    }
  }, [inViewport])

  // IntersectionObserver: unmount iframe when far from viewport.
  // Trace lives outside the state updater so React 18 strict-mode's double-invoke
  // for purity checks doesn't double-emit the trace event.
  const lastTracedInViewport = useRef(true)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const next = entry.isIntersecting
          if (lastTracedInViewport.current !== next) {
            lastTracedInViewport.current = next
            window.app.trace?.('miniapp.standalone', 'block-viewport-change', {
              toolUseId, inViewport: next,
            })
          }
          setInViewport(next)
        }
      },
      { rootMargin: VIEWPORT_ROOT_MARGIN },
    )
    obs.observe(el)
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolUseId])

  return (
    <div ref={containerRef} className="my-0.5">
      {inViewport ? (
        <iframe
          ref={iframeRef}
          src={src}
          sandbox="allow-scripts allow-same-origin"
          className="w-full rounded-md border border-border bg-background"
          style={{ height }}
        />
      ) : (
        <div
          className={cn(
            'w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground',
            'flex items-center gap-1.5',
          )}
          style={{ minHeight: Math.max(height, PLACEHOLDER_MIN_HEIGHT) }}
        >
          <MiniAppIcon appId={appId} className="size-3.5 shrink-0" />
          <span className="font-medium text-foreground/80">{appName}</span>
          <span className="text-muted-foreground/70">·</span>
          <span>{toolReadableName}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/50">cached</span>
        </div>
      )}
    </div>
  )
}
