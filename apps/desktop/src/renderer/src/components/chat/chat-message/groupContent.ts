import { useMemo, useRef } from 'react'
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
  type GroupedContent,
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
  previous?: GroupedContent,
): GroupContentResult {
  return groupContentPresenter(content, createDesktopGroupContentPorts(apps), previous)
}

/** A turn's grouping, carried from one streamed delta to the next. */
export function useGroupedContent(content: ContentBlock[] | null, apps: MiniAppEntry[]): GroupContentResult | null {
  const last = useRef<GroupedContent & { apps: MiniAppEntry[] } | null>(null)
  return useMemo(() => {
    if (!content) return null
    const result = groupContent(content, apps, last.current?.apps === apps ? last.current : undefined)
    last.current = { content, apps, result }
    return result
  }, [content, apps])
}

export type { GroupContentResult, RenderSegment } from '../presenters/groupContent'
