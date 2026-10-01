import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Maximize2, X } from 'lucide-react'
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps/app-bridge'
import { McpAppsError, type McpUiResourceMeta, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { createMcpAppDocument, mcpAppHostContext } from '@superone/shared/mcp-apps-host'
import { createMcpAppHost, createMcpAppHostSlot, type McpAppHost } from '@superone/shared/mcp-apps-host/host'
import { createMcpAppTransport } from '@superone/shared/mcp-apps-host/transport'
import { requestNative } from './bridge'
import { McpAppConsentCard, type McpAppConsentRequest } from './McpAppConsentCard'
import { buildMcpAppSrcdoc, markMcpAppActivated, mcpAppNeedsActivation, mobileMcpAppCsp, setMcpAppFullscreenExit } from './mcp-app-document'
import { createMcpAppExecutor, runMcpAppOperation, type McpAppConsent, type McpAppDisplayMode } from './mcp-app-executor'
import { PortableTurnContext } from './portable-turn-context'

const MIN_HEIGHT = 80
/** Taller Views scroll inside their frame; the transcript keeps its own scroll. */
const MAX_INLINE_HEIGHT = 720

// One slot per View: a remount (DOM windowing, StrictMode) revokes the old document's bridge
// before the new one connects, and the old transport closes before the new one starts.
const slots = new Map<string, ReturnType<typeof createMcpAppHostSlot>>()
function slotFor(appInstanceId: string) {
  let slot = slots.get(appInstanceId)
  if (!slot) slots.set(appInstanceId, slot = createMcpAppHostSlot())
  return slot
}

const COLOR_SOURCES = {
  background: '--background', foreground: '--foreground', muted: '--muted',
  mutedForeground: '--muted-foreground', border: '--border', primary: '--primary',
  primaryForeground: '--primary-foreground', destructive: '--error',
} as const

function readHostContext(node: HTMLElement, scheme: 'light' | 'dark', fullscreen: boolean) {
  const styles = getComputedStyle(node)
  const root = getComputedStyle(document.documentElement)
  const inset = (edge: string) => Number.parseFloat(root.getPropertyValue(`--safe-area-${edge}`)) || 0
  const colors = Object.fromEntries(Object.entries(COLOR_SOURCES)
    .map(([key, token]) => [key, styles.getPropertyValue(token).trim()])
    .filter(([, value]) => value))
  return mcpAppHostContext({
    theme: scheme,
    platform: 'mobile',
    locale: document.documentElement.lang || 'en',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    displayMode: fullscreen ? 'fullscreen' : 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    width: node.clientWidth,
    maxHeight: fullscreen ? window.innerHeight : MAX_INLINE_HEIGHT,
    touch: true,
    hover: false,
    safeAreaInsets: fullscreen
      ? { top: inset('top'), right: inset('right'), bottom: inset('bottom'), left: inset('left') }
      : { top: 0, right: 0, bottom: 0, left: 0 },
    colors,
    fontFamily: styles.fontFamily,
    radius: styles.getPropertyValue('--radius').trim() || undefined,
  })
}

export interface McpAppFrameProps {
  app: ToolAppAttachment
  messageId: string
  html: string
  meta: McpUiResourceMeta | undefined
}

/**
 * The live half of a View: an opaque `srcdoc` frame and its AppBridge. Loaded lazily, so the
 * MCP SDK is only evaluated once a transcript actually shows an App.
 */
export default function McpAppFrame({ app, messageId, html, meta }: McpAppFrameProps) {
  const { t } = useTranslation()
  const { scheme } = useContext(PortableTurnContext)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<McpAppHost | null>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [revoked, setRevoked] = useState(false)
  const [restart, setRestart] = useState(0)
  const [inactive, setInactive] = useState(() => mcpAppNeedsActivation(app.appInstanceId))
  const [activating, setActivating] = useState<'idle' | 'busy' | string>('idle')
  const [fullscreen, setFullscreen] = useState(false)
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const [consent, setConsent] = useState<McpAppConsentRequest | null>(null)
  const target = useMemo(() => ({ messageId, appInstanceId: app.appInstanceId }), [messageId, app.appInstanceId])

  const ask: McpAppConsent = useMemo(() => {
    const approve: McpAppConsent['approve'] = (prompt) =>
      new Promise((resolve) => setConsent({ prompt, resolve: (decision) => { setConsent(null); resolve(decision) } }))
    return {
      approve,
      confirmLink: async (url) => Boolean(await approve({ kind: 'openLink', server: app.binding.server, url })),
    }
  }, [app.binding.server])
  const display = useCallback((mode: McpAppDisplayMode): McpAppDisplayMode => {
    const next = mode === 'fullscreen' ? 'fullscreen' : 'inline'
    setFullscreen(next === 'fullscreen')
    return next
  }, [])

  useEffect(() => {
    if (!fullscreen) return
    // RN routes the Android back button and the iOS edge swipe here while this is open.
    requestNative('mcpAppFullscreen', { active: true })
    const release = setMcpAppFullscreenExit(() => setFullscreen(false))
    return () => {
      release()
      requestNative('mcpAppFullscreen', { active: false })
    }
  }, [fullscreen])

  // Layout effect: the bridge must listen before the frame's first script runs, and the
  // frame's WindowProxy exists from mount; `srcdoc` is only assigned once it listens.
  useLayoutEffect(() => {
    const frame = frameRef.current?.contentWindow
    if (!frame || !root) return
    const slot = slotFor(app.appInstanceId)
    const document = createMcpAppDocument()
    const host = createMcpAppHost({
      app,
      document,
      transport: createMcpAppTransport(frame, 'null'),
      executor: createMcpAppExecutor(target, ask, display),
      context: readHostContext(root, scheme, false),
      capabilities: {
        openLinks: {}, serverTools: {}, serverResources: {}, logging: {},
        updateModelContext: { text: {} }, message: { text: {} },
        sandbox: { permissions: {}, csp: mobileMcpAppCsp(meta) },
      } satisfies McpUiHostCapabilities,
      restored: mcpAppNeedsActivation(app.appInstanceId),
      onSizeChanged: (size) => { if (size.height) setHeight(Math.min(MAX_INLINE_HEIGHT, Math.max(MIN_HEIGHT, size.height))) },
      onUnknownOutcome: () => setUnknownOutcome(true),
      // The host stopped serving this View; the executor already forgot its activation.
      onError: (error) => { if (error instanceof McpAppsError && error.code === 'inactive') { setInactive(true); setActivating('idle') } },
    })
    slot.replace(host)
    hostRef.current = host
    const stop = document.onRevoke(() => setRevoked(true))
    let cancelled = false
    setSrcdoc(null)
    void host.connect().then(() => { if (!cancelled) setSrcdoc(buildMcpAppSrcdoc(html, meta)) })
    return () => {
      cancelled = true
      stop()
      if (hostRef.current === host) hostRef.current = null
      void slot.release(host)
    }
    // The attachment itself flows in through `update`; a new document is only for a new View,
    // new HTML, or an explicit restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.appInstanceId, html, meta, root, restart])

  useEffect(() => { void hostRef.current?.update(app).catch(() => {}) }, [app])

  useEffect(() => {
    if (root) hostRef.current?.updateContext(readHostContext(root, scheme, fullscreen))
  }, [root, scheme, fullscreen])

  const onLoad = () => {
    // The initial about:blank load precedes `srcdoc`; only the View's own document counts.
    if (srcdoc) hostRef.current?.document.loaded()
  }

  const activate = async () => {
    setActivating('busy')
    try {
      await runMcpAppOperation(target, { operation: 'activate' }, ask)
      markMcpAppActivated(app.appInstanceId)
      hostRef.current?.activate()
      setInactive(false)
      setActivating('idle')
    } catch (error) {
      setActivating(error instanceof Error ? error.message : String(error))
    }
  }

  const frameStyle = fullscreen ? { width: '100%', height: '100%' } : { width: '100%', height }
  return (
    <div
      ref={setRoot}
      data-mcp-app={app.appInstanceId}
      className={fullscreen
        ? 'fixed inset-0 z-50 flex flex-col bg-background pt-[var(--safe-area-top,0px)] pb-[var(--safe-area-bottom,0px)]'
        : 'my-1.5 w-full'}
    >
      {fullscreen ? (
        <div className="flex h-10 shrink-0 items-center gap-2 px-2">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{app.binding.server}</span>
          <button type="button" aria-label={t('mcpApp.exitFullscreen')} onClick={() => display('inline')} className="-m-1 p-2 text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
      ) : inactive ? (
        <div className="mb-1 flex items-center gap-2 px-0.5">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">{t('mcpApp.activateHint')}</span>
          <button
            type="button"
            disabled={activating === 'busy'}
            onClick={() => { void activate() }}
            className="flex shrink-0 items-center gap-1 rounded bg-muted px-2.5 py-1 text-xs text-foreground disabled:opacity-50"
          >
            {activating === 'busy' ? <Loader2 className="size-3 animate-spin" /> : <Maximize2 className="size-3 rotate-45" />}
            {t('mcpApp.activate')}
          </button>
        </div>
      ) : null}
      <div className={fullscreen ? 'relative min-h-0 flex-1' : 'relative'}>
        {revoked ? (
          <div className="flex flex-col items-start gap-2 rounded-md bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">{t('mcpApp.reloaded')}</p>
            <button type="button" onClick={() => { setRevoked(false); setRestart((value) => value + 1) }} className="rounded bg-muted px-3 py-1.5 text-xs text-foreground">
              {t('mcpApp.restart')}
            </button>
          </div>
        ) : (
          <iframe
            key={restart}
            ref={frameRef}
            title={app.binding.server}
            srcDoc={srcdoc ?? undefined}
            onLoad={onLoad}
            sandbox="allow-scripts allow-forms"
            className={`block rounded-md border-0 ${app.resource?.meta.prefersBorder ?? meta?.prefersBorder ? 'ring-1 ring-border' : ''}`}
            style={frameStyle}
          />
        )}
        {consent ? (
          // Above the frame in fullscreen, where the frame covers the whole document.
          <div className={fullscreen ? 'absolute inset-x-2 bottom-2 z-10' : 'mt-1.5'}>
            <McpAppConsentCard request={consent} />
          </div>
        ) : null}
      </div>
      {typeof activating === 'string' && activating !== 'idle' && activating !== 'busy' ? (
        <p className="mt-1 px-0.5 text-xs text-error">{t('mcpApp.loadFailed', { error: activating })}</p>
      ) : null}
      {unknownOutcome ? <p className="mt-1 px-0.5 text-xs text-muted-foreground">{t('mcpApp.unknownOutcome')}</p> : null}
    </div>
  )
}
