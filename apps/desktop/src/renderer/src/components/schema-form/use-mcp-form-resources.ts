import { useMemo } from 'react'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { useMcpAppFileRoute } from '../mcp-apps/file-apps'
import { useSessionScope } from '@/stores/chat-store/session-scope'

/** Same pane/session as the permission; a remote project never opens this machine's picker. */
export function useMcpFormResources(requestId: string | undefined, enabled: boolean): McpFormResourceActions | undefined {
  const route = useMcpAppFileRoute(useSessionScope())
  return useMemo(() => {
    const api = window.environment
    if (!enabled || !route || !requestId || parseRemoteProjectKey(route.projectPath)
      || !api?.mcpFormPickResources || !api.mcpFormPreviewResource) return undefined
    return {
      pick: async field => {
        const result = await api.mcpFormPickResources(route.sessionId, requestId, field)
        if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
        return result.value
      },
      preview: async (field, optionUri) => {
        const result = await api.mcpFormPreviewResource(route.sessionId, requestId, field, optionUri)
        if (!result.ok) throw new McpAppsError(result.error.code, result.error.message)
        return result.value
      },
    }
  }, [route?.projectPath, route?.sessionId, requestId, enabled])
}
