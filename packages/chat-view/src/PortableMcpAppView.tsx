import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { McpAppsError, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { markMcpAppActivated, mcpAppAwaitsLiveActivation, mcpAppNeedsActivation, startMcpApp } from './mcp-app-document'
import { runMcpAppOperation, type McpAppConsent } from './mcp-app-executor'
import { PortableInlineAction } from './PortableBlockHeader'

const McpAppFrame = lazy(() => import('./McpAppFrame'))

type Resource = NonNullable<ToolAppAttachment['resource']>
type LoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed'; error: McpAppsError | Error }

// Loading and activation never ask for approval; a host that did would be refused here.
const NO_CONSENT: McpAppConsent = { approve: async () => false }

export interface PortableMcpAppViewProps {
  app: ToolAppAttachment
  messageId: string
  toolName: string
  row: McpAppToolRow
}

/** The call's own tool row: a state and its one action at its right edge, or its details open. */
export type McpAppToolRow = (options?: { trailing?: ReactNode; expanded?: boolean }) => ReactNode

/**
 * An MCP App View in place of its tool row, the way a widget stands in a reply. Until there
 * is a View to show (loading, failed, or restored without a snapshot), the call keeps its
 * normal row and the state sits in it. The resource is the host's persisted snapshot when
 * the attachment carries one; otherwise the host loads (and persists) it. A live View
 * activates itself first, since the host answers a device only for Views it activated. A View
 * restored from history waits for the user before anything reaches the server.
 */
export function PortableMcpAppView({ app, messageId, toolName, row }: PortableMcpAppViewProps) {
  const { t } = useTranslation()
  const target = useMemo(() => ({ messageId, appInstanceId: app.appInstanceId }), [messageId, app.appInstanceId])
  const [loaded, setLoaded] = useState<Resource | null>(null)
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const resource = app.resource ?? loaded
  const waitsForUser = !resource && mcpAppNeedsActivation(app.appInstanceId)
  const activating = mcpAppAwaitsLiveActivation(app.appInstanceId)

  const load = useCallback(async (activate: boolean) => {
    setState({ kind: 'loading' })
    try {
      const value = await startMcpApp(app.appInstanceId, async () => {
        if (activate) {
          await runMcpAppOperation(target, { operation: 'activate' }, NO_CONSENT)
          markMcpAppActivated(app.appInstanceId)
        }
        return app.resource ? null : runMcpAppOperation<Resource>(target, { operation: 'load' }, NO_CONSENT)
      })
      if (value) setLoaded(value)
      setState({ kind: 'idle' })
    } catch (error) {
      // The host stopped serving this View: it waits for Activate again instead of failing.
      if (error instanceof McpAppsError && error.code === 'inactive') setState({ kind: 'idle' })
      else setState({ kind: 'failed', error: error instanceof Error ? error : new Error(String(error)) })
    }
  }, [target, app.appInstanceId, app.resource])

  useEffect(() => {
    if (activating || (!resource && !waitsForUser)) void load(activating)
    // Only a live View, or one that appears without its resource, starts by itself, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.appInstanceId])

  // The frame rebuilds its document when these change, so keep them stable per snapshot.
  const html = resource?.html
  const meta = useMemo(() => resource?.meta, [resource?.hash]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === 'failed') {
    const auth = state.error instanceof McpAppsError && state.error.code === 'auth_required'
    return row({ trailing: (
      <>
        <span className="min-w-0 truncate text-error">
          {auth ? t('mcpApp.authRequired', { server: app.binding.server }) : t('mcpApp.loadFailed', { error: state.error.message })}
        </span>
        <PortableInlineAction label={t('mcpApp.retry')} onPress={() => { void load(waitsForUser || activating) }} />
      </>
    ) })
  }
  const loading = <><Loader2 className="size-3 shrink-0 animate-spin" /><span className="truncate">{t('mcpApp.loading')}</span></>
  // A live View's snapshot waits for its activation: the View calls out as soon as it runs.
  if (!html || activating) {
    return row({ trailing: state.kind === 'loading' || !waitsForUser
      ? loading
      : <PortableInlineAction label={t('mcpApp.activate')} onPress={() => { void load(true) }} /> })
  }
  return (
    <Suspense fallback={row({ trailing: loading })}>
      <McpAppFrame app={app} messageId={messageId} html={html} meta={meta} toolName={toolName} row={row} />
    </Suspense>
  )
}
