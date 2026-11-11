import { useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-core'
import { parseMcpAppStandaloneSessionId } from '@superone/shared/mcp-app-entrypoints'
import { McpAppConsentComposer } from './McpAppConsent'
import { useHasMcpAppConsent } from './consent-store'
import { useMcpAppLayout } from './layout-store'

/** The document is owned outside Dockview; this panel only supplies a destination. */
export function McpAppPanel({ params }: IDockviewPanelProps<{ appInstanceId: string }>) {
  const ref = useCallback((element: HTMLDivElement | null) => useMcpAppLayout.getState().surface(params.appInstanceId, 'fullscreen', element), [params.appInstanceId])
  const overlayRef = useCallback((element: HTMLDivElement | null) => useMcpAppLayout.getState().overlay(params.appInstanceId, element), [params.appInstanceId])
  const sessionId = useMcpAppLayout(state => state.views[params.appInstanceId]?.route.sessionId ?? '')
  const isStandalone = Boolean(sessionId && parseMcpAppStandaloneSessionId(sessionId))
  const hasConsent = useHasMcpAppConsent(isStandalone ? sessionId : null)
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={ref} data-mcp-app-fullscreen={params.appInstanceId} className="h-full w-full overflow-hidden" />
      <div ref={overlayRef} data-mcp-app-panel-overlay={params.appInstanceId} className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 empty:hidden" />
      {isStandalone && hasConsent && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-2 z-20">
          <McpAppConsentComposer sessionId={sessionId} framed />
        </div>
      )}
    </div>
  )
}
