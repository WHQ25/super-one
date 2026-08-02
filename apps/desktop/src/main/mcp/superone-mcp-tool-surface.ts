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
  executeMobileShareFileTool,
  getSessionHost,
  getAppSettingsApplier,
  isMobileShareToolEnabled,
  miniappToolDepsForSurface,
  notifyDevAppReady,
} from './superone-mcp-server'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'
import {
  executeMiniappCall,
  executeMiniappList,
  getMiniappFixedToolDescriptors,
} from './miniapp-mcp-tools'
import {
  MINIAPP_CALL_TOOL_NAME,
  MINIAPP_LIST_TOOL_NAME,
} from './miniapp-call-policy'

export function listSuperoneMcpTools(sessionId: string): SuperoneMcpToolDescriptor[] {
  const collaborationEnabled = readAppSettings().experimentalAgentCollaborationEnabled
  const tools = [
    ...BUILT_IN_SUPERONE_TOOL_DEFS.filter((tool) => collaborationEnabled
      || !(SESSION_COLLABORATION_TOOL_NAMES as readonly string[]).includes(tool.name)),
    ...getBrowserToolDescriptors(),
    ...getMiniappFixedToolDescriptors() as SuperoneMcpToolDescriptor[],
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
  // Mini-app tools are no longer listed per-app — fixed miniapp_list / miniapp_call only.
  void sessionId
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

  if (toolName === MINIAPP_LIST_TOOL_NAME) {
    return executeMiniappList(sessionId, {
      appId: typeof args.appId === 'string' ? args.appId : undefined,
      includeSchema: typeof args.includeSchema === 'boolean' ? args.includeSchema : undefined,
    }, miniappToolDepsForSurface())
  }

  if (toolName === MINIAPP_CALL_TOOL_NAME) {
    return executeMiniappCall(sessionId, {
      appId: String(args.appId ?? ''),
      tool: String(args.tool ?? ''),
      input: (args.input && typeof args.input === 'object' && !Array.isArray(args.input))
        ? args.input as Record<string, unknown>
        : {},
    }, miniappToolDepsForSurface())
  }

  throw new Error(`Unknown SuperOne MCP tool: ${toolName}`)
}
