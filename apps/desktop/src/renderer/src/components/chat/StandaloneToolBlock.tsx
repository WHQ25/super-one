import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app'
import { useIsDark } from '@/hooks/use-is-dark'
import { buildStandaloneToolUrl } from '@superone/shared/miniapp-types'
import { buildMiniAppUrlHost } from '@superone/shared/miniapp-url'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { MiniAppWebview, type MiniAppWebviewHandle } from '@/components/miniapp/MiniAppWebview'
import { readThemeVars } from '@/components/miniapp/miniapp-theme'
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

/** A result-only WebView; all tool computation runs in the Node MiniApp Host. */
export function StandaloneToolBlock(props: Props) {
  const { appId, toolUseId, toolName, appName, toolReadableName, args, result, isStreaming, templatePath } = props
  const projectId = useAppStore((s) => s.currentProjectId)
  const projectDir = useAppStore((s) => s.currentFolder) ?? ''
  const isDark = useIsDark()
  const containerRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<MiniAppWebviewHandle>(null)
  const readyRef = useRef(false)
  const [inViewport, setInViewport] = useState(true)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)

  const host = buildMiniAppUrlHost(appId, projectId)
  const src = useMemo(
    () => buildStandaloneToolUrl(host, toolUseId, toolName, templatePath),
    [host, toolUseId, toolName, templatePath],
  )
  const parsedResult = useMemo(() => {
    if (!result || isStreaming) return null
    try { return JSON.parse(result) } catch { return result }
  }, [result, isStreaming])

  const sendData = useCallback(() => {
    if (!readyRef.current) return
    webviewRef.current?.send({
      type: 'miniapp-standalone-data',
      arguments: args,
      result: parsedResult,
      error: null,
    })
  }, [args, parsedResult])

  const handleMessage = useCallback((channel: string, data: Record<string, unknown>, send: (message: unknown) => void) => {
    if (channel === 'miniapp-ready') {
      readyRef.current = true
      send({ type: 'miniapp-theme', vars: readThemeVars(), isDark })
      send({ type: 'miniapp-standalone-data', arguments: args, result: parsedResult, error: null })
      return
    }
    if (channel === 'miniapp-resize' && typeof data.height === 'number' && data.height > 0) {
      setHeight(Math.max(data.height, PLACEHOLDER_MIN_HEIGHT))
      return
    }
    if (projectDir) handleMiniAppMessage(channel, data, appId, projectDir, send)
  }, [appId, args, isDark, parsedResult, projectDir])

  useEffect(sendData, [sendData])

  useEffect(() => {
    if (!inViewport) {
      readyRef.current = false
      return
    }
    return window.miniapp.onHostMessage((event) => {
      if (event.appId === appId && event.projectDir === projectDir) {
        webviewRef.current?.send({ type: 'miniapp-node-message', payload: event.payload })
      }
    })
  }, [appId, inViewport, projectDir])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => setInViewport(entry.isIntersecting)),
      { rootMargin: VIEWPORT_ROOT_MARGIN },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="my-0.5">
      {inViewport ? (
        <div className="w-full overflow-hidden rounded-md border border-border bg-background" style={{ height }}>
          <MiniAppWebview
            ref={webviewRef}
            appId={appId}
            src={src}
            onMessage={handleMessage}
            className="block size-full"
            style={{ border: 'none' }}
          />
        </div>
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
          <span className="ml-auto text-xs text-muted-foreground/50">cached</span>
        </div>
      )}
    </div>
  )
}
