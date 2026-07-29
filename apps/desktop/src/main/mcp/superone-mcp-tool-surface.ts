import {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  type BuiltInSuperoneToolName,
  executeBuiltInSuperoneTool,
} from './superone-mcp-builtins'
import {
  MOBILE_SHARE_FILE_DESCRIPTION,
  MOBILE_SHARE_FILE_INPUT_SCHEMA,
  MOBILE_SHARE_FILE_TOOL_NAME,
  SESSION_COLLABORATION_TOOL_NAMES,
} from './superone-mcp-builtin-defs'
import { readAppSettings } from '../app-settings-service'
import {
  executeBrowserTool,
  getBrowserToolDescriptors,
  isBrowserToolName,
} from './browser-mcp-tools'
import {
  executeComputerUseTool,
  getComputerUseToolDescriptors,
  isComputerUseEnabled,
  isComputerUseToolName,
} from '../computer-use/tools'
import {
  dispatchAppToolCall,
  executeMobileShareFileTool,
  getAppToolDefs,
  getSessionHost,
  getAppSettingsApplier,
  isMobileShareToolEnabled,
  notifyDevAppReady,
} from './superone-mcp-server'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

export function listSuperoneMcpTools(sessionId: string): SuperoneMcpToolDescriptor[] {
  const collaborationEnabled = readAppSettings().experimentalAgentCollaborationEnabled
  const tools = [
    ...BUILT_IN_SUPERONE_TOOL_DEFS.filter((tool) => collaborationEnabled
      || !(SESSION_COLLABORATION_TOOL_NAMES as readonly string[]).includes(tool.name)),
    ...getBrowserToolDescriptors(),
  ]
  // Computer Use is opt-in (default off). P0 exposes the 6-tool contract only when enabled.
  if (isComputerUseEnabled()) {
    tools.push(...getComputerUseToolDescriptors())
  }
  // Match in-process MCP: only advertise mobile share while a phone is subscribed.
  if (isMobileShareToolEnabled(sessionId)) {
    tools.push({
      name: MOBILE_SHARE_FILE_TOOL_NAME,
      description: MOBILE_SHARE_FILE_DESCRIPTION,
      inputSchema: MOBILE_SHARE_FILE_INPUT_SCHEMA as SuperoneMcpToolDescriptor['inputSchema'],
    })
  }
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
  if (isBrowserToolName(toolName)) {
    return executeBrowserTool(sessionId, toolName, args)
  }

  if (isComputerUseToolName(toolName)) {
    if (!isComputerUseEnabled()) {
      return {
        content: [{ type: 'text' as const, text: '[Error] Computer Use is disabled. Enable it before calling computer_* tools.' }],
        isError: true,
      }
    }
    return executeComputerUseTool(sessionId, toolName, args)
  }

  if (toolName === MOBILE_SHARE_FILE_TOOL_NAME) {
    if (!isMobileShareToolEnabled(sessionId)) {
      return {
        content: [{ type: 'text' as const, text: '[Error] Mobile share is not available for this session.' }],
        isError: true,
      }
    }
    return executeMobileShareFileTool(sessionId, args)
  }

  if ((BUILT_IN_SUPERONE_TOOL_NAMES as readonly string[]).includes(toolName)) {
    if ((SESSION_COLLABORATION_TOOL_NAMES as readonly string[]).includes(toolName)
      && !readAppSettings().experimentalAgentCollaborationEnabled) {
      return {
        content: [{ type: 'text' as const, text: '[Error] Agent session collaboration is disabled.' }],
        isError: true,
      }
    }
    return executeBuiltInSuperoneTool(toolName as BuiltInSuperoneToolName, args, {
      notifyDevAppReady,
      sessionId,
      sessionHost: getSessionHost(),
      applyAppSettings: getAppSettingsApplier(),
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
      const result = await dispatchAppToolCall(
        sessionId,
        entry.projectDir,
        entry.appId,
        appToolName,
        toolDef.standalone === true,
        args,
      )
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `[Error] ${err instanceof Error ? err.message : String(err)}` }] }
    }
  }

  throw new Error(`Unknown SuperOne MCP tool: ${toolName}`)
}
