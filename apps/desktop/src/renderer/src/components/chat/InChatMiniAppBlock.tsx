import { useRef, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Bug, RotateCw } from 'lucide-react'
import { useMiniAppStore } from '@/stores/miniapp'
import { useAppStore } from '@/stores/app'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useMiniAppBridge } from '@/hooks/useMiniAppBridge'
import { handleMiniAppMessage } from '@/hooks/miniapp-message-handler'
import { useIsDark } from '@/hooks/use-is-dark'
import { readThemeVars } from '@/components/miniapp/miniapp-theme'
import { buildMiniAppHost } from '@superone/shared/miniapp-host'

interface InChatMiniAppBlockProps {
  appId: string
  data: Record<string, unknown>
}

function InChatIframe({ appId, data }: InChatMiniAppBlockProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)
  const dataRef = useRef(data)
  dataRef.current = data

  const handleReady = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'miniapp-inchat-init', data: dataRef.current },
      '*',
    )
  }, [])

  const handleResize = useCallback((h: number) => {
    setHeight(h)
  }, [])

  useMiniAppBridge({ appId, iframeRef, onReady: handleReady, onResize: handleResize, inChatMode: true })

  const projectId = useAppStore((s) => s.currentProjectId)

  return (
    <iframe
      ref={iframeRef}
      src={`superone-app://${buildMiniAppHost(appId, projectId)}/index.html`}
      sandbox="allow-scripts allow-same-origin"
      className="w-full border-0"
      style={{ height }}
    />
  )
}

function InChatWebview({ appId, data, onWebviewRef }: InChatMiniAppBlockProps & { onWebviewRef?: (ref: Electron.WebviewTag | null) => void }) {
  const [height, setHeight] = useState(0)
  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  const isDark = useIsDark()
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark
  const readyRef = useRef(false)
  const dataRef = useRef(data)
  dataRef.current = data
  const wvRef = useRef<Electron.WebviewTag | null>(null)

  useEffect(() => {
    window.miniapp.getPreloadPath().then(setPreloadPath)
  }, [])

  const handleIpcRef = useRef<((e: Electron.IpcMessageEvent) => void) | null>(null)

  const webviewCallbackRef = useCallback((wv: Electron.WebviewTag | null) => {
    const prevWv = wvRef.current
    if (prevWv && handleIpcRef.current) {
      prevWv.removeEventListener('ipc-message', handleIpcRef.current)
    }
    wvRef.current = wv
    onWebviewRef?.(wv)
    if (!wv) { handleIpcRef.current = null; return }

    const wvSend = (msg: unknown) => { const m = msg as Record<string, unknown>; wv.send(m.type as string, m) }

    const handleIpc = (event: Electron.IpcMessageEvent) => {
      const { channel, args } = event
      const d = args[0] as Record<string, unknown>

      if (handleMiniAppMessage(channel, d, appId, wvSend)) return

      switch (channel) {
        case 'miniapp-ready':
          readyRef.current = true
          window.miniapp.iframeReady(appId)
          wv.send('miniapp-theme', { vars: readThemeVars(), isDark: isDarkRef.current })
          wv.send('miniapp-inchat-init', { data: dataRef.current })
          break
        case 'miniapp-resize':
          if (typeof d.height === 'number' && d.height > 0) {
            setHeight(d.height)
          }
          break
      }
    }

    handleIpcRef.current = handleIpc
    wv.addEventListener('ipc-message', handleIpc)
  }, [appId, onWebviewRef])

  useEffect(() => {
    if (!readyRef.current) return
    wvRef.current?.send('miniapp-theme', { vars: readThemeVars(), isDark })
  }, [isDark])

  const projectId = useAppStore((s) => s.currentProjectId)

  if (!preloadPath) return null

  return (
    <webview
      ref={webviewCallbackRef}
      src={`superone-app://${buildMiniAppHost(appId, projectId)}/index.html`}
      preload={`file://${preloadPath}`}
      className="w-full border-0"
      style={{ height: height || undefined, minHeight: height ? undefined : 40 }}
    />
  )
}

export function InChatMiniAppBlock({ appId, data }: InChatMiniAppBlockProps) {
  const { t } = useTranslation()
  const app = useMiniAppStore((s) => s.apps.find((a) => a.id === appId))
  const isDev = app?.manifest.isDev
  const appName = app?.manifest.name ?? appId
  const wvRef = useRef<Electron.WebviewTag | null>(null)

  return (
    <div className="group/inchat my-2 w-full">
      <div className="flex h-5 items-center justify-end gap-1.5 px-1 opacity-0 transition-opacity group-hover/inchat:opacity-100">
        <MiniAppIcon appId={appId} className="size-3.5" />
        <span className="text-xs text-muted-foreground/70">{appName}</span>
        {isDev && (
          <>
            <button
              onClick={() => wvRef.current?.reload()}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
              title={t('tooltips.reload')}
            >
              <RotateCw className="size-3" />
            </button>
            <button
              onClick={() => wvRef.current?.openDevTools()}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
              title={t('tooltips.openDevTools')}
            >
              <Bug className="size-3.5" />
            </button>
          </>
        )}
      </div>
      {isDev
        ? <InChatWebview appId={appId} data={data} onWebviewRef={(ref) => { wvRef.current = ref }} />
        : <InChatIframe appId={appId} data={data} />
      }
    </div>
  )
}
