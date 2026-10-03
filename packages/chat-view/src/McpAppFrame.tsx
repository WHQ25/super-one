import { mcpAppServerTitle, mcpAppResourceModes } from '@superone/shared/mcp-apps-metadata'
import { mcpAppMessageCapabilities } from '@superone/shared/mcp-apps-host/capabilities'
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Maximize, Power, RotateCw } from 'lucide-react'
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps/app-bridge'
import { boundedToolAppAttachment, MCP_APP_OUTPUT_MAX_BYTES, McpAppsError, type McpUiResourceMeta, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { createMcpAppDocument, mcpAppHostContext } from '@superone/shared/mcp-apps-host'
import { createMcpAppHost, createMcpAppHostSlot, type McpAppHost } from '@superone/shared/mcp-apps-host/host'
import { createMcpAppTransport } from '@superone/shared/mcp-apps-host/transport'
import { requestNative } from './bridge'
import { McpAppConsentCard, type McpAppConsentRequest } from './McpAppConsentCard'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { McpAppActivateButton, McpAppStateButton, useMcpAppEmphasis, type McpAppState } from '@superone/ui/components/ui/mcp-app-state'
import { cn } from '@superone/ui/lib/utils'
import { McpAppChrome } from './McpAppChrome'
import { buildMcpAppSrcdoc, markMcpAppActivated, mcpAppNeedsActivation, mobileMcpAppCsp, setMcpAppFullscreenExit } from './mcp-app-document'
import { createMcpAppExecutor, runMcpAppOperation, type McpAppConsent, type McpAppDisplayMode } from './mcp-app-executor'
import { PortableTurnContext } from './portable-turn-context'

const MIN_HEIGHT = 80
/** Taller Views scroll inside their frame; the transcript keeps its own scroll. */
const MAX_INLINE_HEIGHT = 480

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
  /** The call's tool row, expanded, behind the header's details toggle. */
  details: ReactNode
}

/**
 * The live half of a View: an opaque `srcdoc` frame and its AppBridge. Loaded lazily, so the
 * MCP SDK is only evaluated once a transcript actually shows an App. It wears the desktop's
 * frame (`McpAppChrome`): the same header actions, state card and collapse. The phone's one
 * other display mode is fullscreen, offered when both the resource and the View allow it: the
 * View covers the transcript without its frame, and the native header above names it and is
 * the way back out.
 */
export default function McpAppFrame({ app: rawApp, messageId, html, meta, toolName, details }: McpAppFrameProps) {
  const app = useMemo(() => boundedToolAppAttachment(rawApp, MCP_APP_OUTPUT_MAX_BYTES, true), [rawApp])
  const { t } = useTranslation()
  const { scheme } = useContext(PortableTurnContext)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<McpAppHost | null>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [initialized, setInitialized] = useState(false)
  const [viewModes, setViewModes] = useState<string[]>([])
  const [revoked, setRevoked] = useState(false)
  const [restart, setRestart] = useState(0)
  const [inactive, setInactive] = useState(() => mcpAppNeedsActivation(app.appInstanceId))
  const [activating, setActivating] = useState(false)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [emphasized, emphasize] = useMcpAppEmphasis()
  const [fullscreen, setFullscreen] = useState(false)
  // Collapsing only zeroes the inline height: the document stays connected and keeps its width.
  const [collapsed, setCollapsed] = useState(false)
  // Only the user's toggle animates; View-reported height changes apply immediately.
  const [collapsing, setCollapsing] = useState(false)
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

  const server = mcpAppServerTitle(app)
  const available = initialized && !unknownOutcome && !revoked
  const restoring = available && inactive
  // Activate and the state card live in the frame's header, which fullscreen hides, so any
  // of those states shows the View inline instead.
  const expanded = fullscreen && available && !inactive

  useEffect(() => {
    if (!expanded) return
    // RN swaps its header for the View's and routes the Android back button and the iOS edge
    // swipe here while this is open.
    requestNative('mcpAppFullscreen', { active: true, title: server })
    const release = setMcpAppFullscreenExit(() => setFullscreen(false))
    return () => {
      release()
      requestNative('mcpAppFullscreen', { active: false })
    }
  }, [expanded, server])

  // Layout effect: the bridge must listen before the frame's first script runs, and the
  // frame's WindowProxy exists from mount; `srcdoc` is only assigned once it listens.
  useLayoutEffect(() => {
    const frame = frameRef.current?.contentWindow
    if (!frame || !root) return
    const slot = slotFor(app.appInstanceId)
    const document = createMcpAppDocument()
    setInitialized(false)
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
      onInitialized: () => { setViewModes(host.appCapabilities()?.availableDisplayModes ?? ['inline']); setInitialized(true) },
      onSizeChanged: (size) => { if (size.height) setHeight(Math.min(MAX_INLINE_HEIGHT, Math.max(MIN_HEIGHT, size.height))) },
      onUnknownOutcome: () => { setUnknownOutcome(true); setFullscreen(false) },
      // A restored View tried to call out, or the host stopped serving it; either way it
      // waits for Activate, and the attempt points the user there.
      onError: (error) => {
        if (!(error instanceof McpAppsError) || error.code !== 'inactive') return
        setInactive(true)
        setActivating(false)
        setFullscreen(false)
        emphasize()
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
    if (root) hostRef.current?.updateContext(readHostContext(root, scheme, expanded, meta))
  }, [root, scheme, expanded])

  const onLoad = () => {
    // The initial about:blank load precedes `srcdoc`; only the View's own document counts.
    if (srcdoc) hostRef.current?.document.loaded()
  }

  const activate = async () => {
    setActivating(true)
    setActivationError(null)
    try {
      await runMcpAppOperation(target, { operation: 'activate' }, ask)
      markMcpAppActivated(app.appInstanceId)
      setInactive(false)
      // Reuse the pinned HTML, metadata and attachment; the new initialize sees
      // persisted model context and may retry the App's own startup calls.
      setRestart((value) => value + 1)
    } catch (error) {
      // Signing in happens on the desktop; the phone can only try again afterwards.
      setActivationError(error instanceof McpAppsError && error.code === 'auth_required'
        ? t('mcpApp.authRequired', { server: app.binding.server })
        : error instanceof Error ? error.message : String(error))
    } finally {
      setActivating(false)
    }
  }

  // Host-initiated modes are limited to those both the resource and the View declare.
  const canExpand = available && !restoring && !expanded && viewModes.includes('fullscreen')
    && (mcpAppResourceModes(meta) ?? ['fullscreen']).includes('fullscreen')
  const shown = available && (expanded || !collapsed)
  const state: McpAppState | null = available ? null
    : revoked ? { message: t('mcpApp.revoked'), action: <McpAppStateButton icon={<RotateCw className="size-3.5" />} label={t('mcpApp.restart')} onClick={() => { setRevoked(false); setRestart((value) => value + 1) }} /> }
    : unknownOutcome ? { message: t('mcpApp.unknown') }
    : { message: t('mcpApp.loading'), icon: <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> }
  return (
    <div
      ref={setRoot}
      data-mcp-app={app.appInstanceId}
      data-mcp-app-fullscreen={expanded || undefined}
      className={expanded ? 'fixed inset-0 z-50 flex flex-col bg-background' : undefined}
    >
      <McpAppChrome
        app={app}
        toolName={toolName}
        details={details}
        state={state}
        // Hidden rather than unmounted: dropping the frame would remount the iframe and reload the View.
        className={expanded ? 'my-0 flex min-h-0 flex-1 flex-col [&>[data-embedded-tool-header]]:hidden' : undefined}
        collapsed={!expanded && collapsed}
        onToggleCollapsed={!available || expanded ? undefined : () => {
          if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setCollapsing(true)
          setCollapsed((value) => !value)
        }}
        actions={canExpand ? <IconButton size="xs" variant="ghost" tooltip={t('mcpApp.fullscreen')} onClick={() => display('fullscreen')}><Maximize className="size-3" /></IconButton> : null}
        activation={restoring ? (
          <McpAppActivateButton emphasized={emphasized} disabled={activating} aria-label={t('mcpApp.activate')} data-mcp-app-result-omitted={app.toolResultOmitted ? '' : undefined}
            // Why the snapshot is empty belongs with the action that refills it.
            tooltip={t(app.toolResultOmitted ? 'mcpApp.resultOmitted' : 'mcpApp.activateTooltip')} onClick={() => { void activate() }}>
            {activating ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}
          </McpAppActivateButton>
        ) : null}
        notice={restoring && activationError ? (
          <div data-mcp-app-restore-note className="mb-2 min-w-0 text-xs">
            <p role="alert" className="break-words text-error">{activationError}</p>
          </div>
        ) : null}
      >
        <div className={expanded ? 'relative min-h-0 flex-1' : 'relative'}>
          {/* Zero height rather than `hidden` while loading: the View lays out at its real width. */}
          <div
            aria-hidden={!shown || undefined}
            style={{ height: expanded ? '100%' : shown ? height : 0 }}
            onTransitionEnd={(event) => { if (event.target === event.currentTarget && event.propertyName === 'height') setCollapsing(false) }}
            className={cn('w-full overflow-hidden', !expanded && 'rounded-md',
              shown && !expanded && (app.resource?.meta.prefersBorder ?? meta?.prefersBorder) && 'ring-1 ring-border',
              collapsing && 'transition-[height] duration-200 ease-out motion-reduce:transition-none')}
          >
            <iframe
              key={restart}
              ref={frameRef}
              title={server}
              srcDoc={srcdoc ?? undefined}
              onLoad={onLoad}
              sandbox="allow-scripts allow-forms"
              className="block border-0"
              style={expanded ? { width: '100%', height: '100%' } : { width: '100%', height }}
            />
          </div>
          {consent ? (
            // Above the frame in fullscreen, where the frame covers the whole document.
            <div className={expanded ? 'absolute inset-x-2 bottom-2 z-10' : 'mt-1.5'}>
              <McpAppConsentCard request={consent} />
            </div>
          ) : null}
        </div>
      </McpAppChrome>
    </div>
  )
}
