import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { McpAppsError, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppPreparedDocument } from '@superone/shared/mcp-apps-desktop'
import type { McpAppHost } from '@superone/shared/mcp-apps-host'
import { mcpAppHostContext } from '@superone/shared/mcp-apps-host/context'
import { Button } from '@superone/ui/components/ui/button'
import { Alert, AlertDescription } from '@superone/ui/components/ui/alert'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import { useChatStore, useSessionScope } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import { useSlotBounds } from '@/hooks/useSlotBounds'
import { Z } from '@/lib/z-layers'
import { createDesktopMcpAppExecutor, type McpAppConsent, type McpAppDesktopApi, type McpAppRoute } from './desktop-executor'
import { McpAppConsent as ConsentDialog, type PendingMcpConsent } from './McpAppConsent'

const Frame = lazy(() => import('./McpAppFrame'))
type Ready = Extract<McpAppPreparedDocument, { state: 'ready' }>

export default function McpAppView({ app, route: explicitRoute, api: explicitApi }: { app: ToolAppAttachment; route?: McpAppRoute; api?: McpAppDesktopApi }) {
  const { t, i18n } = useTranslation()
  const scope = useSessionScope()
  const projectPath = useChatStore(state => Object.entries(state.projectSessions).find(([, project]) => !!project._sessions[app.binding.session])?.[0])
  const route = useMemo(() => explicitRoute ?? { projectPath: scope?.sessionId === app.binding.session ? scope.projectPath : projectPath ?? '', sessionId: app.binding.session }, [explicitRoute, scope?.sessionId, scope?.projectPath, projectPath, app.binding.session])
  const api = explicitApi ?? window.environment
  const [ready, setReady] = useState<Ready | null>(null)
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<McpAppsError | null>(null)
  const [unknown, setUnknown] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [height, setHeight] = useState(240)
  const [initialized, setInitialized] = useState(false)
  const [pending, setPending] = useState<PendingMcpConsent[]>([])
  const host = useRef<McpAppHost | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState<DOMRectReadOnly | null>(null)
  const [clip, setClip] = useState('inset(0px)')
  const isDark = useIsDark()
  const onError = useCallback((value: unknown) => setError(value instanceof McpAppsError ? value : new McpAppsError('invalid', value instanceof Error ? value.message : String(value))), [])
  const consent = useCallback<McpAppConsent>((prompt, signal) => new Promise(resolve => {
    if (signal.aborted) { resolve(null); return }
    const id = crypto.randomUUID()
    const finish = (value: { remember?: boolean } | null) => { signal.removeEventListener('abort', abort); setPending(queue => queue.filter(item => item.id !== id)); resolve(value) }
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
  }, [api, route.projectPath, route.sessionId, app.appInstanceId, generation, onError])
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
  const measure = useCallback((rect: DOMRectReadOnly) => {
    setBounds(rect)
    let top = 0, right = 0, bottom = 0, left = 0
    // Clip the fixed surface at every scroll ancestor; it must never cover chat chrome.
    for (let el = anchor.current?.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue
      const box = el.getBoundingClientRect()
      top = Math.max(top, box.top - rect.top); right = Math.max(right, rect.right - box.right)
      bottom = Math.max(bottom, rect.bottom - box.bottom); left = Math.max(left, box.left - rect.left)
    }
    setClip(`inset(${top}px ${right}px ${bottom}px ${left}px)`)
  }, [])
  useSlotBounds(anchor, `${app.appInstanceId}:${!!ready}`, measure, () => setBounds(null))
  const context = useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    return mcpAppHostContext({ theme: isDark ? 'dark' : 'light', platform: 'desktop', locale: i18n.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, width: bounds?.width, maxHeight: 600,
      colors: { background: css.getPropertyValue('--background').trim(), foreground: css.getPropertyValue('--foreground').trim(), muted: css.getPropertyValue('--muted').trim(), mutedForeground: css.getPropertyValue('--muted-foreground').trim(), border: css.getPropertyValue('--border').trim(), primary: css.getPropertyValue('--primary').trim() },
      fontFamily: css.fontFamily, monoFontFamily: css.getPropertyValue('--font-mono').trim(), radius: css.getPropertyValue('--radius').trim(),
    })
  }, [isDark, i18n.language, bounds?.width])
  const executor = useMemo(() => ready ? createDesktopMcpAppExecutor({ api, route, app, document: ready.document, consent, displayMode: async () => 'inline' }) : null, [api, route, app.appInstanceId, ready, consent])
  return <div className="my-2 min-w-0 rounded-lg border border-border bg-background" data-mcp-app-view={app.appInstanceId}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate font-medium">{app.binding.server}</span>
      {revoked ? <Button size="sm" variant="outline" onClick={() => setGeneration(value => value + 1)}>{t('mcpApp.restart')}</Button>
        : !active && !error ? <Button size="sm" variant="outline" disabled={loading} onClick={() => void activate()}>{t('mcpApp.activate')}</Button> : null}
    </div>
    {loading && !ready && <Skeleton className="mx-3 mb-3 h-32" aria-label={t('mcpApp.loading')} />}
    {!active && !loading && !error && !revoked && <p className="px-3 pb-3 text-xs text-muted-foreground">{t('mcpApp.restored')}</p>}
    {error && <Alert className="mb-2 rounded-none border-x-0"><AlertDescription className="space-y-2">
      <p className="break-words text-xs">{error.message}</p>
      {error.code === 'auth_required' ? <Button size="sm" disabled={loading} onClick={() => void activate(true)}>{t('mcpApp.authenticate')}</Button>
        : !ready && error.code !== 'unknown_outcome' ? <Button size="sm" variant="outline" disabled={loading} onClick={() => setGeneration(value => value + 1)}>{t('mcpApp.retry')}</Button> : null}
    </AlertDescription></Alert>}
    {unknown && <Alert className="mb-2 rounded-none border-x-0"><AlertDescription className="text-xs">{t('mcpApp.unknown')}</AlertDescription></Alert>}
    {revoked && <p className="px-3 pb-3 text-xs text-muted-foreground">{t('mcpApp.revoked')}</p>}
    {ready && <div ref={anchor} style={{ height: Math.max(80, Math.min(height, 600)) }} className="w-full" />}
    {ready && executor && createPortal(<div data-mcp-app-surface={app.appInstanceId} className="fixed overflow-hidden bg-background" style={{ left: bounds?.left ?? 0, top: bounds?.top ?? 0, width: bounds?.width ?? 0, height: bounds?.height ?? 0, clipPath: clip, visibility: bounds && !revoked ? 'visible' : 'hidden', zIndex: Z.HOST_MINIAPP }}>
      <Suspense fallback={<Skeleton className="h-full w-full" />}><Frame app={app} registration={ready.document} api={api} executor={executor} context={context} active={active}
        onHost={value => { host.current = value }} onInitialized={() => setInitialized(true)} onError={onError} onUnknown={() => setUnknown(true)} onRevoked={() => setRevoked(true)} onHeight={setHeight} /></Suspense>
    </div>, document.body)}
    {ready && !initialized && !revoked && <span className="sr-only">{t('mcpApp.loading')}</span>}
    <ConsentDialog pending={pending[0]} />
  </div>
}
