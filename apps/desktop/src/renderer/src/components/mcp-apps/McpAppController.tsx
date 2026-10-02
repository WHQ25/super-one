import { mcpAppHeaderTitle, mcpAppServerTitle, mcpAppPresentationIcon, mcpAppResourceModes } from '@superone/shared/mcp-apps-metadata'
import { lazy, Suspense, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppPreparedDocument } from '@superone/shared/mcp-apps-desktop'
import { mcpAppHostContext } from '@superone/shared/mcp-apps-host/context'
import { CodeXml, Loader2, LogIn, Maximize, Maximize2, PanelRight, PictureInPicture2, Power, RotateCw, Undo2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { EmbeddedToolView } from '@/components/chat/EmbeddedToolView'
import { ToolBrandIcon } from '@/components/chat/ToolIcon'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { getToolDisplay } from '@/components/chat/tool-display'
import { useIsDark } from '@/hooks/use-is-dark'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { miniAppPipViewport } from '@/components/miniapp/miniapp-pip-layout'
import { useMcpAppLayout, type McpAppOwner } from './layout-store'
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
  const panelWidth = useActivityPanelStore(state => state.panelWidth)
  const panelHeight = useActivityPanelStore(state => state.bounds?.height)
  const fullscreenWidth = useActivityPanelStore(state => state.bounds?.width)
  const viewport = useMemo(() => miniAppPipViewport(panelWidth, panelHeight), [panelWidth, panelHeight])
  const [ready, setReady] = useState<Ready | null>(null)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<McpAppsError | null>(null)
  const [unknown, setUnknown] = useState(false)
  const [revoked, setRevoked] = useState(false)
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
  const [emphasized, setEmphasized] = useState(false)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const anchor = useRef<HTMLDivElement>(null)
  const [inlineWidth, setInlineWidth] = useState(0)
  const isDark = useIsDark()
  const icon = mcpAppPresentationIcon(app.presentation, isDark ? 'dark' : 'light') ?? fallbackIcon
  const onError = useCallback((value: unknown) => {
    if (value instanceof McpAppsError && value.code === 'inactive') {
      setActive(false); setError(null); setEmphasized(true)
      clearTimeout(pulseTimer.current)
      pulseTimer.current = setTimeout(() => setEmphasized(false), 1800)
      return
    }
    setError(value instanceof McpAppsError ? value : new McpAppsError('invalid', value instanceof Error ? value.message : String(value)))
  }, [])
  useEffect(() => () => clearTimeout(pulseTimer.current), [])
  const consent = useCallback<McpAppConsent>((prompt, signal) => requestMcpAppConsent(route.sessionId, prompt, signal), [route.sessionId])
  useEffect(() => {
    let cancelled = false
    let documentId: string | undefined
    setLoading(true); setError(null); setReady(null); setRevoked(false); setUnknown(false); setInitialized(false)
    if (!route.projectPath) { onError(new McpAppsError('not_connected', 'MCP App session route unavailable')); setLoading(false); return }
    void api.mcpAppRegister(route.projectPath, route.sessionId, { appInstanceId: app.appInstanceId }).then(result => {
      if (!result.ok) { if (result.error.code === 'approval_required') throw new McpAppsError('denied', 'MCP App preparation requires approval'); throw new McpAppsError(result.error.code, result.error.message) }
      if (result.value.state === 'ready') {
        documentId = result.value.document.id
        if (cancelled) { void api.mcpAppRelease(documentId); return }
        setReady(result.value); setActive(result.value.active)
      } else if (!cancelled) setActive(false)
    }).catch(value => { if (!cancelled) onError(value) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (documentId) void api.mcpAppRelease(documentId).catch(() => {}) }
  }, [api, route.projectPath, route.sessionId, app.appInstanceId, JSON.stringify([app.binding, app.origin, app.resourceUri]), generation, onError])
  const activate = async (authenticate = false) => {
    setLoading(true); setError(null); setActivationError(null)
    try {
      if (authenticate) {
        if (!app.origin) throw new McpAppsError('not_connected', 'MCP App provider origin unavailable')
        const connection = route.projectPath.startsWith('remote:') ? route.projectPath.slice(7).split(':')[0] : 'local'
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
    return mcpAppHostContext({ theme: isDark ? 'dark' : 'light', platform: 'desktop', locale: i18n.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, displayMode: mode,
      // A View opened on a file lives in its tab; returning inline would close it.
      availableDisplayModes: app.file ? ['fullscreen'] : mcpAppResourceModes(ready?.meta) ?? ['inline', 'fullscreen', 'pip'],
      width: mode === 'inline' ? inlineWidth : surface === 'fullscreen' ? fullscreenWidth : surface === 'pip' ? viewport.width : undefined,
      maxHeight: mode === 'inline' ? undefined : surface === 'fullscreen' ? (panelHeight ?? 0) - 34 : surface === 'pip' ? viewport.height : undefined,
      colors: { background: css.getPropertyValue('--background').trim(), foreground: css.getPropertyValue('--foreground').trim(), muted: css.getPropertyValue('--muted').trim(), mutedForeground: css.getPropertyValue('--muted-foreground').trim(), border: css.getPropertyValue('--border').trim(), primary: css.getPropertyValue('--primary').trim() },
      fontFamily: css.fontFamily, monoFontFamily: css.getPropertyValue('--font-mono').trim(), radius: css.getPropertyValue('--radius').trim(),
    })
  }, [isDark, i18n.language, mode, surface, inlineWidth, fullscreenWidth, panelHeight, viewport, ready?.meta, app.file])
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
  const available = !!ready && initialized && !error && !unknown && !revoked
  const restoring = available && !active && surface === 'inline'
  // Host-initiated modes are limited to those both the resource and the View declare.
  const canExpand = available && surface === 'inline' && viewModes.includes('fullscreen')
    && (mcpAppResourceModes(ready?.meta) ?? ['fullscreen']).includes('fullscreen')
  const preparing = !available && !error && !unknown && !revoked && (loading || (!!ready && !initialized))
  // Every state other than an available View shares one card: what is happening and what to do.
  const stateButton = (icon: ReactNode, label: string, onClick: () => void) =>
    <Button data-mcp-app-action size="sm" variant="secondary" disabled={loading} className="h-7 shrink-0 gap-1.5 px-2.5 text-xs" onClick={onClick}>{icon}{label}</Button>
  const stateCard: { message: string; icon?: ReactNode; alert?: boolean; action?: ReactNode } | null = available
    // A View shown elsewhere leaves its row empty; say where it went and offer the way back.
    ? surface === 'inline' ? null : {
      message: t(surface === 'pip' ? 'mcpApp.shownInPip' : 'mcpApp.shownInPanel'),
      icon: surface === 'pip' ? <PictureInPicture2 className="size-3.5 shrink-0 text-muted-foreground" /> : <PanelRight className="size-3.5 shrink-0 text-muted-foreground" />,
      action: <IconButton data-mcp-app-action size="md" tooltip={t('mcpApp.inline')} className="shrink-0" onClick={() => onMode('inline')}><Undo2 className="size-3.5" /></IconButton>,
    }
    : preparing ? { message: t('mcpApp.loading'), icon: <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> }
    : revoked ? { message: t('mcpApp.revoked'), action: stateButton(<RotateCw className="size-3.5" />, t('mcpApp.restart'), () => setGeneration(value => value + 1)) }
    : error?.code === 'auth_required' ? { message: error.message, alert: true, action: stateButton(<LogIn className="size-3.5" />, t('mcpApp.authenticate'), () => void activate(true)) }
    : error && error.code !== 'unknown_outcome' ? { message: error.message, alert: true, action: stateButton(<RotateCw className="size-3.5" />, t('mcpApp.retry'), () => setGeneration(value => value + 1)) }
    : error ? { message: error.message }
    : unknown ? { message: t('mcpApp.unknown') }
    : !ready && !active ? { message: t('mcpApp.restored'), action: stateButton(<Power className="size-3.5" />, t('mcpApp.activate'), () => void activate()) }
    : null
  const row = <>
    <div>
      <EmbeddedToolView pinnedHeader collapsed={collapsed} onToggleCollapsed={!available ? undefined : () => { if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setCollapsing(true); setCollapsed(value => !value) }} title={mcpAppHeaderTitle(mcpAppServerTitle(app), app.presentation?.toolTitle ?? owner.title ?? app.resourceUri)} icon={<ToolBrandIcon src={icon} alt={app.binding.server} icon={getToolDisplay(toolName, {}).icon} />} actions={<>
        {canExpand && <>
          <IconButton size="xs" variant="ghost" tooltip={t('mcpApp.openInPanel')} onClick={() => void openSurface(false)}><Maximize2 className="size-3" /></IconButton>
          <IconButton size="xs" variant="ghost" tooltip={t('tooltips.maximizeActivityPanel')} onClick={() => void openSurface(true)}><Maximize className="size-3" /></IconButton>
        </>}
        {owner.details && <IconButton size="xs" variant="ghost" tooltip={t('mcpApp.toolDetails')} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}><CodeXml className="size-3" /></IconButton>}
        {restoring && (activationError?.code === 'auth_required'
          ? <IconButton data-mcp-app-activate data-emphasized={emphasized || undefined} size="xs" variant="ghost" disabled={loading} tooltip={t('mcpApp.authenticate')} className={emphasized ? 'animate-pulse ring-2 ring-ring/50' : undefined} onClick={() => void activate(true)}><LogIn className="size-3" /></IconButton>
          : <IconButton data-mcp-app-activate data-emphasized={emphasized || undefined} size="xs" variant="ghost" disabled={loading} aria-label={t('mcpApp.activate')} data-mcp-app-result-omitted={app.toolResultOmitted ? '' : undefined}
            // Why the snapshot is empty belongs with the action that refills it.
            tooltip={t(app.toolResultOmitted ? 'mcpApp.resultOmitted' : 'mcpApp.activateTooltip')} className={emphasized ? 'animate-pulse ring-2 ring-ring/50' : undefined} onClick={() => void activate()}><Power className="size-3" /></IconButton>)}
      </>}>
        {stateCard && <div data-mcp-app-state-card className="mb-2 flex min-h-[50px] min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            {stateCard.icon}
            <p role={stateCard.alert ? 'alert' : undefined} className={`min-w-0 break-words ${stateCard.alert ? 'text-error' : 'text-muted-foreground'}`}>{stateCard.message}</p>
          </div>
          {stateCard.action}
        </div>}
        {!collapsed && restoring && activationError && <div data-mcp-app-restore-note className="mb-2 min-w-0 text-xs">
          <p role="alert" className="break-words text-error">{activationError.message}</p>
        </div>}
        {!collapsed && detailsOpen && <div className="mb-2">{owner.details}</div>}
        <div className="relative" hidden={!available}>
          {ready && <div ref={inline} data-mcp-app-surface={app.appInstanceId} style={{ height: surface === 'inline' && !collapsed ? Math.max(80, height) : 0 }}
            onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === 'height') setCollapsing(false) }}
            className={`w-full overflow-hidden rounded-md ${collapsing ? 'transition-[height] duration-200 ease-out motion-reduce:transition-none' : ''}`} />}
        </div>
      </EmbeddedToolView>
    </div>
  </>
  return <>
    {owner.row && createPortal(row, owner.row)}
    {ready && executor && <Suspense fallback={null}><Frame key={reload} app={app} meta={ready.meta} registration={ready.document} api={api} executor={executor} context={context} active={active}
      onHost={() => {}} onInitialized={modes => { setViewModes(modes); setInitialized(true) }} onError={onError} onUnknown={() => setUnknown(true)} onRevoked={() => setRevoked(true)} onHeight={setHeight} /></Suspense>}
    {surface === 'pip' && ready && !revoked && <McpAppPip appInstanceId={app.appInstanceId} title={app.binding.server} toolName={toolName} viewport={viewport} onMode={onMode} />}
  </>
}
