import {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  type BuiltInSuperoneToolName,
  executeBuiltInSuperoneTool,
} from './superone-mcp-builtins'
import {
  executeAppTool,
  getAppToolDefs,
  getSessionHost,
  notifyDevAppReady,
} from './superone-mcp-server'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

export function listSuperoneMcpTools(sessionId: string): SuperoneMcpToolDescriptor[] {
  const tools = [...BUILT_IN_SUPERONE_TOOL_DEFS]
  for (const entry of getAppToolDefs().values()) {
    if (entry.sessionId !== sessionId) continue
    for (const t of entry.tools) {
      tools.push({
        name: `${entry.toolSlug}__${t.name}`,
        description: t.description,
        inputSchema: t.inputSchema,
      })
    }
  }
  return tools
}

export async function executeSuperoneMcpTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  if ((BUILT_IN_SUPERONE_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return executeBuiltInSuperoneTool(toolName as BuiltInSuperoneToolName, args, {
      notifyDevAppReady,
      sessionId,
      sessionHost: getSessionHost(),
    })
  }

  for (const entry of getAppToolDefs().values()) {
    if (entry.sessionId !== sessionId) continue
    const prefix = `${entry.toolSlug}__`
    if (!toolName.startsWith(prefix)) continue
    const appToolName = toolName.slice(prefix.length)
    const toolDef = entry.tools.find((t) => t.name === appToolName)
    if (!toolDef) continue
    try {
      const result = await executeAppTool(sessionId, entry.appId, appToolName, args)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
    }
  }

  throw new Error(`Unknown SuperOne MCP tool: ${toolName}`)
}
