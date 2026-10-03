import type { McpAppResourceSnapshot } from '@superone/shared/mcp-app-resource'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Power, RotateCw } from 'lucide-react'
import { McpAppsError, mcpAppOmittedMessage, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { McpAppStateButton, type McpAppState } from '@superone/ui/components/ui/mcp-app-state'
import { McpAppChrome } from './McpAppChrome'
import { markMcpAppActivated, mcpAppAwaitsLiveActivation, mcpAppNeedsActivation, startMcpApp } from './mcp-app-document'
import { runMcpAppOperation, type McpAppConsent } from './mcp-app-executor'

const McpAppFrame = lazy(() => import('./McpAppFrame'))

type Resource = McpAppResourceSnapshot
type LoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed'; error: McpAppsError | Error }

// Loading and activation never ask for approval; a host that did would be refused here.
const NO_CONSENT: McpAppConsent = { approve: async () => false }

export interface PortableMcpAppViewProps {
  app: ToolAppAttachment
  messageId: string
  toolName: string
  /** The call's tool row, expanded, behind the header's details toggle. */
  details: ReactNode
}

/**
 * An MCP App View in place of its tool row, the way a widget stands in a reply. Until there
 * is a View to show (loading, failed, or restored without a snapshot), the desktop's state
 * card stands in its place under the same header. The resource is the host's persisted snapshot when
 * the attachment carries one; otherwise the host loads (and persists) it. A live View
 * activates itself first, since the host answers a device only for Views it activated. A View
 * restored from history waits for the user before anything reaches the server.
 */
export function PortableMcpAppView({ app, messageId, toolName, details }: PortableMcpAppViewProps) {
  const { t } = useTranslation()
  const target = useMemo(() => ({ messageId, appInstanceId: app.appInstanceId }), [messageId, app.appInstanceId])
  const [loaded, setLoaded] = useState<Resource | null>(null)
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [requiresActivation, setRequiresActivation] = useState(false)
  const resource = app.resource?.html !== undefined ? app.resource as Resource : loaded
  const waitsForUser = requiresActivation || (!app.resource && mcpAppNeedsActivation(app.appInstanceId))
  const activating = mcpAppAwaitsLiveActivation(app.appInstanceId)
  // An omitted initial result leaves its View nothing to show: no document, only the state card.
  const omitted = mcpAppOmittedMessage(app, t)

  const load = useCallback(async (activate: boolean) => {
    setState({ kind: 'loading' })
    try {
      const value = await startMcpApp(app.appInstanceId, async () => {
        if (activate) {
          await runMcpAppOperation(target, { operation: 'activate' }, NO_CONSENT)
          markMcpAppActivated(app.appInstanceId)
        }
        return app.resource?.html !== undefined ? null : runMcpAppOperation<Resource>(target, { operation: 'load' }, NO_CONSENT)
      })
      if (value) setLoaded(value)
      setRequiresActivation(false)
      setState({ kind: 'idle' })
    } catch (error) {
      // The host stopped serving this View: it waits for Activate again instead of failing.
      if (error instanceof McpAppsError && error.code === 'inactive') { setState({ kind: 'idle' }); setRequiresActivation(true) }
      else setState({ kind: 'failed', error: error instanceof Error ? error : new Error(String(error)) })
    }
  }, [target, app.appInstanceId, app.resource])

  useEffect(() => {
    if (!omitted && (activating || (!resource && !waitsForUser))) void load(activating)
    // Only a live View, or one that appears without its resource, starts by itself, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.appInstanceId])

  // The frame rebuilds its document when these change, so keep them stable per snapshot.
  const html = resource?.html
  const meta = useMemo(() => resource?.meta, [resource?.hash]) // eslint-disable-line react-hooks/exhaustive-deps

  const chrome = (card: McpAppState) => <McpAppChrome app={app} toolName={toolName} details={details} state={card} />
  const loading: McpAppState = { message: t('mcpApp.loading'), icon: <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> }
  if (omitted) return chrome({ message: omitted, alert: true })
  if (state.kind === 'failed') {
    // Signing in happens on the desktop; the phone can only try again afterwards.
    const auth = state.error instanceof McpAppsError && state.error.code === 'auth_required'
    return chrome({
      message: auth ? t('mcpApp.authRequired', { server: app.binding.server }) : state.error.message,
      alert: true,
      action: <McpAppStateButton icon={<RotateCw className="size-3.5" />} label={t('mcpApp.retry')} onClick={() => { void load(waitsForUser || activating) }} />,
    })
  }
  // A live View's snapshot waits for its activation: the View calls out as soon as it runs.
  if (!html || activating) {
    return chrome(state.kind === 'loading' || !waitsForUser ? loading : {
      message: t('mcpApp.restored'),
      action: <McpAppStateButton icon={<Power className="size-3.5" />} label={t('mcpApp.activate')} onClick={() => { void load(true) }} />,
    })
  }
  return (
    <Suspense fallback={chrome(loading)}>
      <McpAppFrame app={app} messageId={messageId} html={html} meta={meta} toolName={toolName} details={details} />
    </Suspense>
  )
}
