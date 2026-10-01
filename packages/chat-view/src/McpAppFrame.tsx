import { mcpAppHeaderTitle, mcpAppServerTitle, mcpAppPresentationIcon, mcpAppResourceModes } from '@superone/shared/mcp-apps-metadata'
import { mcpAppMessageCapabilities } from '@superone/shared/mcp-apps-host/capabilities'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CodeXml, Loader2, X } from 'lucide-react'
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps/app-bridge'
import { boundedToolAppAttachment, McpAppsError, type McpUiResourceMeta, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { createMcpAppDocument, mcpAppHostContext } from '@superone/shared/mcp-apps-host'
import { createMcpAppHost, createMcpAppHostSlot, type McpAppHost } from '@superone/shared/mcp-apps-host/host'
import { createMcpAppTransport } from '@superone/shared/mcp-apps-host/transport'
import { requestNative } from './bridge'
import { McpAppConsentCard, type McpAppConsentRequest } from './McpAppConsentCard'
import { PORTABLE_BLOCK_CLASS, PortableBlockHeader, PortableBlockHeaderButton, PortableInlineAction } from './PortableBlockHeader'
import { buildMcpAppSrcdoc, markMcpAppActivated, mcpAppNeedsActivation, mobileMcpAppCsp, setMcpAppFullscreenExit } from './mcp-app-document'
import { createMcpAppExecutor, runMcpAppOperation, type McpAppConsent, type McpAppDisplayMode } from './mcp-app-executor'
import { PortableTurnContext } from './portable-turn-context'
import type { McpAppToolRow } from './PortableMcpAppView'
import { useMcpToolIconSrc } from './PortableToolRow'
import { getToolDisplay, parseMcpToolName } from './presenters/tool-display'
import { ToolBrandIcon } from './presenters/ToolIcon'

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

function readHostContext(node: HTMLElement, scheme: 'light' | 'dark', fullscreen: boolean, meta?: McpUiResourceMeta) {
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
    availableDisplayModes: mcpAppResourceModes(meta) ?? ['inline', 'fullscreen'],
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
  toolName: string
  /** The call's tool row: the raw details on request, and the View's stand-in once it stops. */
  row: McpAppToolRow
}

/**
 * The live half of a View: an opaque `srcdoc` frame and its AppBridge. Loaded lazily, so the
 * MCP SDK is only evaluated once a transcript actually shows an App. It is framed like a
 * widget, under a muted `server · tool` header; the host offers no display modes of its own,
 * only the exit from the fullscreen the View asked for.
 */
export default function McpAppFrame({ app: rawApp, messageId, html, meta, toolName, row }: McpAppFrameProps) {
  const app = useMemo(() => boundedToolAppAttachment(rawApp, true), [rawApp])
  const { t } = useTranslation()
  const { scheme } = useContext(PortableTurnContext)
  const iconSrc = useMcpToolIconSrc(toolName)
  const [details, setDetails] = useState(false)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<McpAppHost | null>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [revoked, setRevoked] = useState(false)
  const [restart, setRestart] = useState(0)
  const [inactive, setInactive] = useState(() => mcpAppNeedsActivation(app.appInstanceId))
  const [activating, setActivating] = useState<'idle' | 'busy' | string>('idle')
  // Counts the View's attempts the host refused while inactive; each one pulses Activate.
  const [nudges, setNudges] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const [consent, setConsent] = useState<McpAppConsentRequest | null>(null)
  const consentRef = useRef<McpAppConsentRequest | null>(null)
  const cancelConsent = useCallback(() => { consentRef.current?.resolve(false) }, [])
  const target = useMemo(() => ({ messageId, appInstanceId: app.appInstanceId }), [messageId, app.appInstanceId])

  const ask: McpAppConsent = useMemo(() => ({
    approve: (prompt, signal) => new Promise((resolve) => {
      if (signal.aborted) { resolve(false); return }
      cancelConsent()
      let settled = false
      const cancel = () => request.resolve(false)
      const request: McpAppConsentRequest = { prompt, resolve: confirmed => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', cancel)
        if (consentRef.current === request) { consentRef.current = null; setConsent(null) }
        resolve(confirmed && !signal.aborted)
      } }
      consentRef.current = request
      signal.addEventListener('abort', cancel, { once: true })
      setConsent(request)
    }),
  }), [cancelConsent])
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
      app, resourceMeta: meta,
      document,
      transport: createMcpAppTransport(frame, 'null'),
      executor: createMcpAppExecutor(target, ask, display),
      context: readHostContext(root, scheme, false, meta),
      capabilities: {
        ...mcpAppMessageCapabilities,
        openLinks: {}, serverTools: {}, serverResources: {}, logging: {},
        sandbox: { permissions: {}, csp: mobileMcpAppCsp(meta) },
      } satisfies McpUiHostCapabilities,
      restored: mcpAppNeedsActivation(app.appInstanceId),
      onSizeChanged: (size) => { if (size.height) setHeight(Math.min(MAX_INLINE_HEIGHT, Math.max(MIN_HEIGHT, size.height))) },
      onUnknownOutcome: () => setUnknownOutcome(true),
      // A restored View tried to call out, or the host stopped serving it; either way it
      // waits for Activate, and the attempt points the user there.
      onError: (error) => {
        if (!(error instanceof McpAppsError) || error.code !== 'inactive') return
        setInactive(true)
        setActivating('idle')
        setNudges((value) => value + 1)
      },
    })
    slot.replace(host)
    hostRef.current = host
    const stop = document.onRevoke(() => { cancelConsent(); setRevoked(true); setFullscreen(false) })
    let cancelled = false
    setSrcdoc(null)
    void host.connect().then(() => { if (!cancelled) setSrcdoc(buildMcpAppSrcdoc(html, meta)) })
    return () => {
      cancelled = true
      cancelConsent()
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
    if (root) hostRef.current?.updateContext(readHostContext(root, scheme, fullscreen, meta))
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
      setInactive(false)
      // Reuse the pinned HTML, metadata and attachment; the new initialize sees
      // persisted model context and may retry the App's own startup calls.
      setRestart((value) => value + 1)
      setActivating('idle')
    } catch (error) {
      setActivating(error instanceof Error ? error.message : String(error))
    }
  }

  // The document is gone; the call is a tool row again until the user restarts its View.
  if (revoked) {
    return (
      <div ref={setRoot} data-mcp-app={app.appInstanceId}>
        {row({ trailing: (
          <>
            <span className="min-w-0 truncate">{t('mcpApp.reloaded')}</span>
            <PortableInlineAction label={t('mcpApp.restart')} onPress={() => { setRevoked(false); setRestart((value) => value + 1) }} />
          </>
        ) })}
      </div>
    )
  }

  const tool = parseMcpToolName(toolName)
  const server = mcpAppServerTitle(app)
  const frameStyle = fullscreen ? { width: '100%', height: '100%' } : { width: '100%', height }
  return (
    <div
      ref={setRoot}
      data-mcp-app={app.appInstanceId}
      className={fullscreen
        ? 'fixed inset-0 z-50 flex flex-col bg-background pt-[var(--safe-area-top,0px)] pb-[var(--safe-area-bottom,0px)]'
        : PORTABLE_BLOCK_CLASS}
    >
      {fullscreen ? (
        <div className="flex h-10 shrink-0 items-center gap-2 px-2">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{server}</span>
          <button type="button" aria-label={t('mcpApp.exitFullscreen')} onClick={() => display('inline')} className="-m-1 p-2 text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <PortableBlockHeader
          icon={<ToolBrandIcon src={mcpAppPresentationIcon(app.presentation, scheme) ?? iconSrc} alt={server} icon={getToolDisplay(toolName, app.toolInput ?? {}).icon} className="text-muted-foreground/70" />}
          title={mcpAppHeaderTitle(server, app.presentation?.toolTitle ?? tool?.mcpToolName ?? app.resourceUri)}
        >
          {inactive ? (
            // Keyed by the attempt so each one restarts the pulse.
            <span key={nudges} className={nudges ? 'rounded motion-safe:animate-[pulse_0.5s_ease-in-out_3]' : undefined}>
              <PortableInlineAction label={t('mcpApp.activate')} disabled={activating === 'busy'} onPress={() => { void activate() }}>
                {activating === 'busy' ? <Loader2 className="size-3 animate-spin" /> : null}
              </PortableInlineAction>
            </span>
          ) : null}
          <PortableBlockHeaderButton label={t('mcpApp.toolDetails')} expanded={details} onPress={() => setDetails((value) => !value)}>
            <CodeXml className="size-3.5" />
          </PortableBlockHeaderButton>
        </PortableBlockHeader>
      )}
      {details && !fullscreen ? <div className="mb-1">{row({ expanded: true })}</div> : null}
      <div className={fullscreen ? 'relative min-h-0 flex-1' : 'relative'}>
        {inactive && <p data-mcp-app-result-omitted={app.toolResultOmitted ? '' : undefined} className="px-2 py-1 text-xs text-muted-foreground">{t(app.toolResultOmitted ? 'mcpApp.resultOmitted' : 'mcpApp.restored')}</p>}
        <iframe
          key={restart}
          ref={frameRef}
          title={server}
          srcDoc={srcdoc ?? undefined}
          onLoad={onLoad}
          sandbox="allow-scripts allow-forms"
          className={`block rounded-md border-0 ${app.resource?.meta.prefersBorder ?? meta?.prefersBorder ? 'ring-1 ring-border' : ''}`}
          style={frameStyle}
        />
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
