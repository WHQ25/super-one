import { mcpAppHeaderTitle, mcpAppServerTitle, mcpAppPresentationIcon, mcpAppPreferredDisplayMode, mcpAppResourceModes } from '@superone/shared/mcp-apps-metadata'
import { lazy, Suspense, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { McpAppsError, mcpAppOmittedMessage } from '@superone/shared/mcp-apps'
import type { McpAppPreparedDocument } from '@superone/shared/mcp-apps-desktop'
import type { McpAppRegisteredTool } from '@superone/shared/mcp-app-tools'
import type { McpAppHost } from '@superone/shared/mcp-apps-host'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { mcpAppHostContext, mcpAppToolInfo } from '@superone/shared/mcp-apps-host/context'
import { CodeXml, Loader2, LogIn, Maximize, Maximize2, PanelRight, PictureInPicture2, Power, RotateCw, Undo2 } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { EmbeddedToolView } from '@superone/ui/components/ui/embedded-tool-view'
import { McpAppActivateButton, McpAppStateButton, McpAppStateCard, useMcpAppEmphasis, type McpAppState } from '@superone/ui/components/ui/mcp-app-state'
import { ToolBrandIcon } from '@/components/chat/ToolIcon'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { getToolDisplay } from '@/components/chat/tool-display'
import { useIsDark } from '@/hooks/use-is-dark'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { miniAppPipViewport } from '@/components/miniapp/miniapp-pip-layout'
import { hasActiveActivityPanelTab } from '@/components/activity/mcp-app-tabs'
import { markMcpAppAutoOpenHandled, useMcpAppLayout, wasMcpAppAutoOpenHandled, type McpAppOwner } from './layout-store'
import { useMcpAppDisplayMode } from './use-display-mode'
import { McpAppPip } from './McpAppPip'
import { createDesktopMcpAppExecutor, type McpAppConsent } from './desktop-executor'
import { navigateMcpAppSession } from './session-navigation'
import { requestMcpAppConsent } from './consent-store'

const Frame = lazy(() => import('./McpAppFrame'))
type Ready = Extract<McpAppPreparedDocument, { state: 'ready' }>

export function McpAppController({ owner }: { owner: McpAppOwner }) {
  const { app, route, api } = owner
  const toolName = owner.toolName ?? `mcp__${app.binding.server}__app`
  const fallbackIcon = useMcpServerIcon(app.binding.server)
  const { t, i18n } = useTranslation()
  const { mode, surface, request: requestMode, open: openSurface } = useMcpAppDisplayMode(app.appInstanceId)
  const panelOverlay = useMcpAppLayout(state => state.overlays[app.appInstanceId] ?? null)
  const panelWidth = useActivityPanelStore(state => state.panelWidth)
  const panelHeight = useActivityPanelStore(state => state.bounds?.height)
  const fullscreenWidth = useActivityPanelStore(state => state.bounds?.width)
  const viewport = useMemo(() => miniAppPipViewport(panelWidth, panelHeight), [panelWidth, panelHeight])
  const [ready, setReady] = useState<Ready | null>(null)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(false)
  // A restored View stays a tool row, its document unmounted, until the user opens its snapshot.
  const [opened, setOpened] = useState(false)
  // An omitted initial result leaves its View nothing to show: no document, only the state card.
  const omitted = mcpAppOmittedMessage(app, t)
  const [error, setError] = useState<McpAppsError | null>(null)
  const [unknown, setUnknown] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [tornDown, setTornDown] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [reload, setReload] = useState(0)
  const [activationError, setActivationError] = useState<McpAppsError | null>(null)
  const [height, setHeight] = useState(240)
  const [initialized, setInitialized] = useState(false)
  const [viewModes, setViewModes] = useState<Array<'inline' | 'fullscreen' | 'pip'>>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Collapsing only zeroes the inline height: the document stays connected and keeps its width.
  const [collapsed, setCollapsed] = useState(false)
  // Only the user's toggle animates; View-reported height changes apply immediately.
  const [collapsing, setCollapsing] = useState(false)
  const [emphasized, emphasize] = useMcpAppEmphasis()
  const anchor = useRef<HTMLDivElement>(null)
  const hostRef = useRef<McpAppHost | null>(null)
  const [inlineWidth, setInlineWidth] = useState(0)
  const isDark = useIsDark()
  const icon = mcpAppPresentationIcon(app.presentation, isDark ? 'dark' : 'light') ?? fallbackIcon
  const onError = useCallback((value: unknown) => {
    if (value instanceof McpAppsError && value.code === 'inactive') {
      // Only a mounted View reports this; it stays shown while it waits for Activate.
      setOpened(true); setActive(false); setError(null); emphasize()
      return
    }
    setError(value instanceof McpAppsError ? value : new McpAppsError('invalid', value instanceof Error ? value.message : String(value)))
  }, [emphasize])
  const consent = useCallback<McpAppConsent>((prompt, signal) => requestMcpAppConsent(route.sessionId, prompt, signal), [route.sessionId])
  const connection = parseRemoteProjectKey(route.projectPath)?.connectionId ?? 'local'
  useEffect(() => {
    let cancelled = false
    let documentId: string | undefined
    setLoading(true); setError(null); setReady(null); setRevoked(false); setTornDown(false); setUnknown(false); setInitialized(false)
    if (omitted) { setLoading(false); return }
    if (!route.sessionId) { onError(new McpAppsError('not_connected', 'MCP App session route unavailable')); setLoading(false); return }
    void api.mcpAppRegister(route.projectPath, route.sessionId, { appInstanceId: app.appInstanceId }).then(result => {
      if (!result.ok) { if (result.error.code === 'approval_required') throw new McpAppsError('denied', 'MCP App preparation requires approval'); throw new McpAppsError(result.error.code, result.error.message) }
      if (result.value.state === 'ready') {
        documentId = result.value.document.id
        if (cancelled) { void api.mcpAppRelease(documentId); return }
        setReady(result.value); setActive(result.value.active)
      } else if (!cancelled) setActive(false)
    }).catch(value => { if (!cancelled) onError(value) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (documentId) void api.mcpAppRelease(documentId).catch(() => {}) }
  }, [api, route.projectPath, route.sessionId, app.appInstanceId, JSON.stringify([app.binding, app.origin, app.resourceUri]), generation, onError, !!omitted])
  const activate = async (authenticate = false) => {
    setLoading(true); setError(null); setActivationError(null)
    try {
      if (authenticate) {
        if (!app.origin) throw new McpAppsError('not_connected', 'MCP App provider origin unavailable')
        const result = await api.mcpAppsAuthenticate(connection, { binding: app.binding, origin: app.origin })
        if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
      }
      const result = await api.mcpAppRequest(route.projectPath, route.sessionId, { appInstanceId: app.appInstanceId, operation: 'activate' })
      if (!result.ok) { if (result.error.code === 'approval_required') throw new McpAppsError('denied', 'Activation requires approval'); throw new McpAppsError(result.error.code, result.error.message) }
      if (ready && !revoked) {
        // Keep this registration's pinned HTML and binding. A fresh bridge lets
        // the App initialize again with activation and persisted context live.
        setActive(true); setInitialized(false); setReload(value => value + 1)
      } else setGeneration(value => value + 1)
    } catch (value) {
      if (ready && !revoked) setActivationError(value instanceof McpAppsError ? value : new McpAppsError('invalid', value instanceof Error ? value.message : String(value)))
      else onError(value)
    } finally { setLoading(false) }
  }
  const inline = useCallback((element: HTMLDivElement | null) => {
    anchor.current = element
    useMcpAppLayout.getState().surface(app.appInstanceId, 'inline', element)
  }, [app.appInstanceId])
  useLayoutEffect(() => {
    const element = anchor.current
    if (!element) return
    const measure = () => setInlineWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure); observer.observe(element)
    return () => observer.disconnect()
  }, [owner.row, ready])
  const context = useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    const panelInnerHeight = panelHeight ? Math.max(0, panelHeight - 34) : undefined
    return mcpAppHostContext({ theme: isDark ? 'dark' : 'light', platform: 'desktop', locale: i18n.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, toolInfo: mcpAppToolInfo(app), displayMode: mode,
      availableDisplayModes: app.file ? ['fullscreen'] : mcpAppResourceModes(ready?.meta) ?? ['inline', 'fullscreen', 'pip'],
      width: mode === 'inline' ? inlineWidth : surface === 'fullscreen' ? fullscreenWidth : surface === 'pip' ? viewport.width : undefined,
      height: surface === 'fullscreen' ? panelInnerHeight : undefined,
      maxHeight: surface === 'pip' ? viewport.height : undefined,
      colors: { background: css.getPropertyValue('--background').trim(), foreground: css.getPropertyValue('--foreground').trim(), muted: css.getPropertyValue('--muted').trim(), mutedForeground: css.getPropertyValue('--muted-foreground').trim(), border: css.getPropertyValue('--border').trim(), primary: css.getPropertyValue('--primary').trim() },
      fontFamily: css.fontFamily, monoFontFamily: css.getPropertyValue('--font-mono').trim(), radius: css.getPropertyValue('--radius').trim(),
    })
  }, [isDark, i18n.language, mode, surface, inlineWidth, fullscreenWidth, panelHeight, viewport, ready?.meta, app.file, app.harnessCallId, app.toolName, app.toolDescriptor])
  const executor = useMemo(() => ready ? createDesktopMcpAppExecutor({ api, route, app, document: ready.document, consent, displayMode: requestMode,
    navigate: navigateMcpAppSession,
  }) : null, [api, route, app.appInstanceId, ready, consent, requestMode])
  const onMode = (next: typeof mode) => { void requestMode(next, new AbortController().signal) }
  useEffect(() => {
    if (surface !== 'fullscreen' || !ready) return
    const exit = () => useMcpAppLayout.getState().setMode(app.appInstanceId, 'inline')
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); exit() }
    }
    const unsubscribe = api.onMcpAppEscape?.(event => { if (event.url === ready.document.url && !document.querySelector('[role="dialog"]')) exit() })
    window.addEventListener('keydown', escape)
    return () => { unsubscribe?.(); window.removeEventListener('keydown', escape) }
  }, [api, surface, ready, app.appInstanceId])
  const effectiveError = useMemo(
    () => error ?? (owner.onClose && app.status === 'error' && app.error ? new McpAppsError(app.error.code, app.error.message) : null),
    [error, owner.onClose, app.status, app.error],
  )
  const available = !!ready && initialized && !effectiveError && !unknown && !revoked && !tornDown
  const restoring = available && !active && surface === 'inline'
  const dormant = !!ready && !active && !opened && surface === 'inline'
  const resourceModes = mcpAppResourceModes(ready?.meta)
  const canExpand = available && surface === 'inline' && viewModes.includes('fullscreen')
    && (resourceModes ?? ['fullscreen']).includes('fullscreen')
  const fullscreenOnly = available && canExpand && ((resourceModes !== undefined && !resourceModes.includes('inline')) || !viewModes.includes('inline'))
  const prefersBorder = (ready?.meta?.prefersBorder ?? app.resource?.meta.prefersBorder) === true
  const preferredMode = mcpAppPreferredDisplayMode(ready?.meta ?? app.resource?.meta)
  useEffect(() => {
    if (!active || owner.onClose || app.file || !available || surface !== 'inline' || !canExpand) return
    if (preferredMode !== 'fullscreen' || app.status !== 'result' || app.toolResult?.isError) return
    if (wasMcpAppAutoOpenHandled(app.appInstanceId) || hasActiveActivityPanelTab()) return
    markMcpAppAutoOpenHandled(app.appInstanceId)
    void openSurface(false)
  }, [active, owner.onClose, app.file, available, surface, canExpand, preferredMode, app.status, app.toolResult?.isError, app.appInstanceId, openSurface])
  const onToolsChanged = useCallback((tools: McpAppRegisteredTool[]) => {
    if (!route.projectPath || !route.sessionId) return
    void api.mcpAppToolsSync?.(route.projectPath, route.sessionId, { viewId: app.appInstanceId, tools }).catch(() => {})
  }, [api, route.projectPath, route.sessionId, app.appInstanceId])
  useEffect(() => {
    return () => {
      if (!route.projectPath || !route.sessionId) return
      void api.mcpAppToolsSync?.(route.projectPath, route.sessionId, { viewId: app.appInstanceId, tools: [] }).catch(() => {})
    }
  }, [api, route.projectPath, route.sessionId, app.appInstanceId])
  useEffect(() => {
    if (!api.onMcpAppToolRequest || !api.mcpAppToolsRespond) return
    const inFlight = new Map<string, AbortController>()
    const unsubscribe = api.onMcpAppToolRequest(request => {
      if (request.sessionId !== route.sessionId || request.viewId !== app.appInstanceId) return
      if (request.kind === 'cancel') {
        inFlight.get(request.requestId)?.abort()
        inFlight.delete(request.requestId)
        return
      }
      const controller = new AbortController()
      inFlight.set(request.requestId, controller)
      if (request.kind === 'approve') {
        void requestMcpAppConsent(route.sessionId, request.prompt, controller.signal).then(answer => {
          inFlight.delete(request.requestId)
          void api.mcpAppToolsRespond!({
            kind: 'approve',
            requestId: request.requestId,
            approved: !!answer,
            ...(answer?.alwaysAllow ? { alwaysAllow: true } : {}),
            ...(controller.signal.aborted ? { cancelled: true } : {}),
          }).catch(() => {})
        })
        return
      }
      const host = hostRef.current
      if (!host) {
        inFlight.delete(request.requestId)
        void api.mcpAppToolsRespond!({
          kind: 'call',
          requestId: request.requestId,
          ok: false,
          error: { code: 'not_connected', message: 'MCP App View is not active' },
        }).catch(() => {})
        return
      }
      void host.callViewTool(request.toolName, request.args, controller.signal).then(
        result => {
          inFlight.delete(request.requestId)
          void api.mcpAppToolsRespond!({ kind: 'call', requestId: request.requestId, ok: true, result }).catch(() => {})
        },
        err => {
          inFlight.delete(request.requestId)
          const code = err instanceof McpAppsError ? err.code : undefined
          const message = err instanceof Error ? err.message : String(err)
          void api.mcpAppToolsRespond!({ kind: 'call', requestId: request.requestId, ok: false, error: { code, message } }).catch(() => {})
        },
      )
    })
    return () => {
      unsubscribe()
      for (const controller of inFlight.values()) controller.abort()
      inFlight.clear()
    }
  }, [api, route.sessionId, app.appInstanceId])
  const onRequestTeardown = useCallback(() => {
    if (owner.onClose) {
      useMcpAppLayout.getState().setMode(app.appInstanceId, 'inline')
      return
    }
    if (useMcpAppLayout.getState().views[app.appInstanceId]?.mode !== 'inline') {
      useMcpAppLayout.getState().setMode(app.appInstanceId, 'inline')
    }
    setTornDown(true)
  }, [owner.onClose, app.appInstanceId])
  const preparing = !dormant && !available && !effectiveError && !unknown && !revoked && !tornDown && (loading || (!!ready && !initialized))
  const stateButton = (icon: ReactNode, label: string, onClick: () => void) => <McpAppStateButton icon={icon} label={label} disabled={loading} onClick={onClick} />
  const stateCard: McpAppState | null = omitted ? { message: omitted, alert: true }
    : available
    ? surface === 'inline'
      ? fullscreenOnly
        ? { message: t('mcpApp.fullscreenOnly'), icon: <PanelRight className="size-3.5 shrink-0 text-muted-foreground" />, action: stateButton(<PanelRight className="size-3.5" />, t('mcpApp.openInPanel'), () => void openSurface(false)) }
        : null
      : {
        message: t(surface === 'pip' ? 'mcpApp.shownInPip' : 'mcpApp.shownInPanel'),
        icon: surface === 'pip' ? <PictureInPicture2 className="size-3.5 shrink-0 text-muted-foreground" /> : <PanelRight className="size-3.5 shrink-0 text-muted-foreground" />,
        action: <IconButton data-mcp-app-action size="md" tooltip={t('mcpApp.inline')} className="shrink-0" onClick={() => onMode('inline')}><Undo2 className="size-3.5" /></IconButton>,
      }
    : preparing ? { message: t('mcpApp.loading'), icon: <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> }
    : tornDown ? { message: t('mcpApp.closed'), action: stateButton(<RotateCw className="size-3.5" />, t('mcpApp.restart'), () => setGeneration(value => value + 1)) }
    : revoked ? { message: t('mcpApp.revoked'), action: stateButton(<RotateCw className="size-3.5" />, t('mcpApp.restart'), () => setGeneration(value => value + 1)) }
    : effectiveError?.code === 'auth_required' ? { message: effectiveError.message, alert: true, action: stateButton(<LogIn className="size-3.5" />, t('mcpApp.authenticate'), () => void activate(true)) }
    : effectiveError && effectiveError.code !== 'unknown_outcome' ? { message: effectiveError.message, alert: true, action: stateButton(<RotateCw className="size-3.5" />, t('mcpApp.retry'), () => setGeneration(value => value + 1)) }
    : effectiveError ? { message: effectiveError.message }
    : unknown ? { message: t('mcpApp.unknown') }
    : !ready && !active ? { message: t('mcpApp.restored'), action: stateButton(<Power className="size-3.5" />, t('mcpApp.activate'), () => void activate()) }
    : null
  const row = <>
    <div>
      <EmbeddedToolView collapsed={dormant || collapsed} expandLabel={t('tooltips.expandView')} collapseLabel={t('tooltips.collapseView')} onToggleCollapsed={dormant ? () => setOpened(true) : !available ? undefined : () => { if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setCollapsing(true); setCollapsed(value => !value) }} title={mcpAppHeaderTitle(mcpAppServerTitle(app), app.presentation?.toolTitle ?? owner.title ?? app.resourceUri)} icon={<ToolBrandIcon src={icon} alt={app.binding.server} icon={getToolDisplay(toolName, {}).icon} />} actions={<>
        {canExpand && <>
          <IconButton size="xs" variant="ghost" tooltip={t('mcpApp.openInPanel')} onClick={() => void openSurface(false)}><Maximize2 className="size-3" /></IconButton>
          <IconButton size="xs" variant="ghost" tooltip={t('tooltips.maximizeActivityPanel')} onClick={() => void openSurface(true)}><Maximize className="size-3" /></IconButton>
        </>}
        {owner.details && <IconButton size="xs" variant="ghost" tooltip={t('mcpApp.toolDetails')} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}><CodeXml className="size-3" /></IconButton>}
        {(restoring || dormant) && (activationError?.code === 'auth_required'
          ? <McpAppActivateButton emphasized={emphasized} disabled={loading} tooltip={t('mcpApp.authenticate')} onClick={() => void activate(true)}><LogIn className="size-3" /></McpAppActivateButton>
          : <McpAppActivateButton emphasized={emphasized} disabled={loading} aria-label={t('mcpApp.activate')}
            tooltip={t('mcpApp.activateTooltip')} onClick={() => void activate()}>{dormant && loading ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}</McpAppActivateButton>)}
      </>}>
        {stateCard && <McpAppStateCard state={stateCard} />}
        {(dormant || !collapsed && restoring) && activationError && <div data-mcp-app-restore-note className="mb-2 min-w-0 text-xs">
          <p role="alert" className="break-words text-error">{activationError.message}</p>
        </div>}
        {!collapsed && detailsOpen && <div className="mb-2">{owner.details}</div>}
        <div className="relative" hidden={!available || fullscreenOnly}>
          {ready && <div ref={inline} data-mcp-app-surface={app.appInstanceId} style={{ height: surface === 'inline' && !collapsed && !fullscreenOnly ? Math.max(80, height) : 0 }}
            onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'height') setCollapsing(false) }}
            className={`w-full overflow-hidden rounded-md ${surface === 'inline' && !collapsed && !fullscreenOnly && prefersBorder ? 'ring-1 ring-border ' : ''}${collapsing ? 'transition-[height] duration-200 ease-out motion-reduce:transition-none' : ''}`} />}
        </div>
      </EmbeddedToolView>
    </div>
  </>
  return <>
    {owner.row && createPortal(row, owner.row)}
    {!owner.row && surface === 'fullscreen' && !available && stateCard && panelOverlay && createPortal(
      <div className="pointer-events-auto w-full max-w-md">
        <McpAppStateCard state={stateCard} />
        {activationError && (
          <p role="alert" className="mt-2 break-words text-xs text-error">{activationError.message}</p>
        )}
      </div>,
      panelOverlay,
    )}
    {ready && executor && !omitted && !dormant && !tornDown && <Suspense fallback={null}><Frame key={reload} app={app} localSession={connection === 'local'} meta={ready.meta} registration={ready.document} api={api} executor={executor} context={context} active={active}
      onHost={host => { hostRef.current = host }} onInitialized={modes => { setViewModes(modes); setInitialized(true) }} onError={onError} onUnknown={() => setUnknown(true)} onRevoked={() => setRevoked(true)} onRequestTeardown={onRequestTeardown} onToolsChanged={onToolsChanged} onHeight={setHeight} /></Suspense>}
    {surface === 'pip' && ready && !revoked && !tornDown && <McpAppPip appInstanceId={app.appInstanceId} title={app.binding.server} toolName={toolName} viewport={viewport} onMode={onMode} />}
  </>
}
