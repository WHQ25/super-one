import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { useChatStore, useSessionScope } from '@/stores/chat'
import type { McpAppDesktopApi, McpAppRoute } from './desktop-executor'
import { useMcpAppLayout } from './layout-store'

/** Transcript attachment. The persistent host owns its document and bridge. */
export interface McpAppViewProps {
  app: ToolAppAttachment
  route?: McpAppRoute
  api?: McpAppDesktopApi
  title?: string
  details?: ReactNode
  renderFallback?: (trailing: ReactNode) => ReactNode
}
export default function McpAppView({ app, route: explicitRoute, api: explicitApi, title, details, renderFallback }: McpAppViewProps) {
  const scope = useSessionScope()
  const projectPath = useChatStore(state => Object.entries(state.projectSessions).find(([, project]) => !!project._sessions[app.binding.session])?.[0])
  const route = useMemo(() => explicitRoute ?? { projectPath: scope?.sessionId === app.binding.session ? scope.projectPath : projectPath ?? '', sessionId: app.binding.session }, [explicitRoute, scope?.sessionId, scope?.projectPath, projectPath, app.binding.session])
  const api = explicitApi ?? window.environment
  const row = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => useMcpAppLayout.getState().claim({ app, route, api, title, details, renderFallback, row: row.current }), [app, route, api, title, details, renderFallback])
  return <div ref={row} className="min-w-0" data-mcp-app-view={app.appInstanceId} />
}
