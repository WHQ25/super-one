import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppPreparedDocument } from '@superone/shared/mcp-apps-desktop'
import type { McpAppHost } from '@superone/shared/mcp-apps-host'
import { mcpAppHostContext } from '@superone/shared/mcp-apps-host/context'
import { Button } from '@superone/ui/components/ui/button'
import { Code, Puzzle } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { EmbeddedToolView } from '@/components/chat/EmbeddedToolView'
import { useMcpServerIcon } from '@/components/chat/use-mcp-server-icon'
import { useIsDark } from '@/hooks/use-is-dark'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { miniAppPipViewport } from '@/components/miniapp/miniapp-pip-layout'
import { useMcpAppLayout, type McpAppOwner } from './layout-store'
import { useMcpAppDisplayMode } from './use-display-mode'
import { McpAppPip } from './McpAppPip'
import { McpAppFullscreen } from './McpAppFullscreen'
import { createDesktopMcpAppExecutor, type McpAppConsent } from './desktop-executor'
import { McpAppConsent as ConsentDialog, type PendingMcpConsent } from './McpAppConsent'

const Frame = lazy(() => import('./McpAppFrame'))
type Ready = Extract<McpAppPreparedDocument, { state: 'ready' }>

export function McpAppController({ owner, fullscreenArea }: { owner: McpAppOwner; fullscreenArea: { element: HTMLElement; width: number; height: number } | null }) {
  const { app, route, api } = owner
  const { t, i18n } = useTranslation()
  const { mode, surface, request: requestMode } = useMcpAppDisplayMode(app.appInstanceId)
  const panelWidth = useActivityPanelStore(state => state.panelWidth)
  const panelHeight = useActivityPanelStore(state => state.bounds?.height)
  const viewport = useMemo(() => miniAppPipViewport(panelWidth, panelHeight), [panelWidth, panelHeight])
  const [ready, setReady] = useState<Ready | null>(null)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<McpAppsError | null>(null)
  const [unknown, setUnknown] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [height, setHeight] = useState(240)
  const [initialized, setInitialized] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [emphasized, setEmphasized] = useState(false)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const icon = useMcpServerIcon(app.binding.server)
  const [pending, setPending] = useState<PendingMcpConsent[]>([])
  const host = useRef<McpAppHost | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const [inlineWidth, setInlineWidth] = useState(0)
  const isDark = useIsDark()
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
  const consent = useCallback<McpAppConsent>((prompt, signal) => new Promise(resolve => {
    if (signal.aborted) { resolve(null); return }
    const id = crypto.randomUUID()
    const finish = (value: Record<string, never> | null) => { signal.removeEventListener('abort', abort); setPending(queue => queue.filter(item => item.id !== id)); resolve(value) }
    const abort = () => finish(null)
    signal.addEventListener('abort', abort, { once: true })
    setPending(queue => [...queue, { id, prompt, finish }])
  }), [])
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
    setLoading(true); setError(null)
    try {
      if (authenticate) {
        if (!app.origin) throw new McpAppsError('not_connected', 'MCP App provider origin unavailable')
        const connection = route.projectPath.startsWith('remote:') ? route.projectPath.slice(7).split(':')[0] : 'local'
        const result = await api.mcpAppsAuthenticate(connection, { binding: app.binding, origin: app.origin })
        if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
      }
      const result = await api.mcpAppRequest(route.projectPath, route.sessionId, { appInstanceId: app.appInstanceId, operation: 'activate' })
      if (!result.ok) { if (result.error.code === 'approval_required') throw new McpAppsError('denied', 'Activation requires approval'); throw new McpAppsError(result.error.code, result.error.message) }
      if (ready && !revoked) { host.current?.activate(); setActive(true) } else setGeneration(value => value + 1)
    } catch (value) { onError(value) } finally { setLoading(false) }
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
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, displayMode: mode, availableDisplayModes: ['inline', 'fullscreen', 'pip'],
      width: mode === 'inline' ? inlineWidth : surface === 'fullscreen' ? fullscreenArea?.width : surface === 'pip' ? viewport.width : undefined,
      maxHeight: mode === 'inline' ? 600 : surface === 'fullscreen' ? (fullscreenArea?.height ?? 0) - 36 : surface === 'pip' ? viewport.height : undefined,
      colors: { background: css.getPropertyValue('--background').trim(), foreground: css.getPropertyValue('--foreground').trim(), muted: css.getPropertyValue('--muted').trim(), mutedForeground: css.getPropertyValue('--muted-foreground').trim(), border: css.getPropertyValue('--border').trim(), primary: css.getPropertyValue('--primary').trim() },
      fontFamily: css.fontFamily, monoFontFamily: css.getPropertyValue('--font-mono').trim(), radius: css.getPropertyValue('--radius').trim(),
    })
  }, [isDark, i18n.language, mode, surface, inlineWidth, fullscreenArea?.width, fullscreenArea?.height, viewport])
  const executor = useMemo(() => ready ? createDesktopMcpAppExecutor({ api, route, app, document: ready.document, consent, displayMode: requestMode }) : null, [api, route, app.appInstanceId, ready, consent, requestMode])
  const onMode = (next: typeof mode) => { void requestMode(next, new AbortController().signal) }
  const available = !!ready && initialized && !error && !unknown && !revoked
  const action = revoked
    ? <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" disabled={loading} onClick={() => setGeneration(value => value + 1)}>{t('mcpApp.restart')}</Button>
    : error?.code === 'auth_required'
      ? <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" disabled={loading} onClick={() => void activate(true)}>{t('mcpApp.authenticate')}</Button>
      : error && error.code !== 'unknown_outcome'
        ? <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" disabled={loading} onClick={() => setGeneration(value => value + 1)}>{t('mcpApp.retry')}</Button>
        : !active && !loading && !unknown && (!ready || initialized)
          ? <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => void activate()}>{t('mcpApp.activate')}</Button> : null
  const status = revoked ? t('mcpApp.revoked') : unknown ? t('mcpApp.unknown') : error?.message ?? (loading || (ready && !initialized) ? t('mcpApp.loading') : t('mcpApp.restored'))
  const trailing = <><span title={status} className="max-w-40 truncate text-xs text-muted-foreground">{status}</span>{action}</>
  const row = <>
    {!available && (owner.renderFallback?.(trailing) ?? <div className="flex items-center justify-end gap-1.5 text-xs">{trailing}</div>)}
    {/* Keep the destination connected while showing the normal error/pending row. */}
    <div hidden={!available}>
      <EmbeddedToolView title={`${app.binding.server} · ${owner.title ?? app.resourceUri}`} icon={icon ? <img src={icon} alt="" className="size-3.5 shrink-0" /> : <Puzzle className="size-3.5 shrink-0" />} actions={owner.details && <IconButton size="xs" variant="ghost" tooltip={t('trajectory.inspector.tools')} aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}><Code className="size-3.5" /></IconButton>}>
        {detailsOpen && <div className="mb-2">{owner.details}</div>}
        <div className="relative">
          {ready && <div ref={inline} data-mcp-app-surface={app.appInstanceId} style={{ height: surface === 'inline' ? Math.max(80, Math.min(height, 600)) : 0 }} className="w-full overflow-hidden rounded-md" />}
          {available && !active && !loading && surface === 'inline' && <Button data-mcp-app-activate data-emphasized={emphasized || undefined} size="sm" variant="secondary" className={`absolute right-2 top-2 h-6 px-2 text-xs text-muted-foreground ${emphasized ? 'animate-pulse ring-2 ring-ring/50' : ''}`} title={t('mcpApp.restored')} onClick={() => void activate()}>{t('mcpApp.activate')}</Button>}
        </div>
        {ready && !initialized && <span className="sr-only">{t('mcpApp.loading')}</span>}
      </EmbeddedToolView>
    </div>
  </>
  return <>
    {owner.row && createPortal(row, owner.row)}
    {ready && executor && <Suspense fallback={null}><Frame app={app} meta={ready.meta} registration={ready.document} api={api} executor={executor} context={context} active={active}
      onHost={value => { host.current = value }} onInitialized={() => setInitialized(true)} onError={onError} onUnknown={() => setUnknown(true)} onRevoked={() => setRevoked(true)} onHeight={setHeight} /></Suspense>}
    {surface === 'fullscreen' && ready && !revoked && <McpAppFullscreen appInstanceId={app.appInstanceId} server={app.binding.server} container={fullscreenArea?.element} api={api} url={ready.document.url} onExit={() => onMode('inline')} />}
    {surface === 'pip' && ready && !revoked && <McpAppPip appInstanceId={app.appInstanceId} title={app.binding.server} viewport={viewport} onMode={onMode} />}
    <ConsentDialog pending={pending[0]} />
  </>
}
