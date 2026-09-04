import type { ContentBlock } from '@superone/shared/agent-types'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'
import { resolveMiniAppToolIdentity } from '@/lib/miniapp-tool-identity'
import { isHiddenToolBlock, parseMcpToolName } from '../tool-display'
import { isSubagentToolName } from '../subagent-utils'
import { isWorkflowSmokeCheck } from '../workflow-utils'
import {
  groupContentPresenter,
  type GroupContentPorts,
  type GroupContentResult,
} from '../presenters/groupContent'

function createDesktopGroupContentPorts(apps: MiniAppEntry[]): GroupContentPorts {
  return {
    isHiddenToolBlock,
    isSubagentToolName,
    isWorkflowSmokeCheck,
    resolveAppTool(toolName, input) {
      const mcp = parseMcpToolName(toolName)
      if (!mcp || mcp.serverName !== 'superone') return null

      let params: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(input)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed
      } catch {
        // Streaming tool input can be incomplete; it is not groupable yet.
      }

      const resolved = resolveMiniAppToolIdentity(mcp.mcpToolName, params, apps)
      if (!resolved) return null
      return {
        appId: resolved.appId,
        groupable: resolved.toolDef?.groupable === true,
        standalone: resolved.toolDef?.standalone === true,
      }
    },
  }
}

/** Desktop adapter for the host-agnostic content grouping pass. */
export function groupContent(
  content: ContentBlock[],
  apps: MiniAppEntry[],
): GroupContentResult {
  return groupContentPresenter(content, createDesktopGroupContentPorts(apps))
}

export type { GroupContentResult, RenderSegment } from '../presenters/groupContent'
