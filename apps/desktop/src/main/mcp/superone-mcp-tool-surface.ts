import {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  type BuiltInSuperoneToolName,
  executeBuiltInSuperoneTool,
} from './superone-mcp-builtins'
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
  executeDeviceAgentTool,
  getDeviceAgentToolDescriptors,
  isDeviceAgentEnabled,
  isDeviceAgentToolName,
} from '../device-agent'
import {
  getSessionHost,
  getAppSettingsApplier,
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
import {
  listWidgetTemplatesHandler,
  executeWidgetShowTool,
} from '../generative-ui/mcp-server'
import {
  CODEX_MANAGED_BROWSER_COMPUTER_DENIED_MESSAGE,
  isCodexBrowserAndComputerUseDenied,
} from '../codex/codex-managed-capability-policy'

const WIDGET_LIST_TEMPLATES_NAME = 'widget_list_templates'
const WIDGET_SHOW_NAME = 'widget_show'

const WIDGET_LIST_TEMPLATES_DESCRIPTOR: SuperoneMcpToolDescriptor = {
  name: WIDGET_LIST_TEMPLATES_NAME,
  description:
    'List reusable widget templates saved in the current project or user scope. Call this when considering template reuse; pass a returned id to widget_show.template.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
}

const WIDGET_SHOW_DESCRIPTOR: SuperoneMcpToolDescriptor = {
  name: WIDGET_SHOW_NAME,
  description:
    'Render SVG, diagrams, charts, or interactive HTML inline in chat. Pass widget_code for new content, or template + data to reuse a saved template. To show media you produced yourself, pass a @native/* template so it renders in SuperOne\'s own gallery (viewer, download, drag-out) instead of a lookalike you build in widget_code — call widget_list_templates for the list. Before the first new widget in a session, load the relevant design modules with read_manual({ domain: "widget", modules: [...] }).',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short snake_case identifier for this widget.' },
      widget_code: { type: 'string' },
      template: { type: 'string' },
      data: { type: 'object', additionalProperties: true },
      reusable: { type: 'object', additionalProperties: true },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    required: ['title'],
    additionalProperties: false,
  },
}

export function listSuperoneMcpTools(sessionId: string): SuperoneMcpToolDescriptor[] {
  const browserAndComputerUseDenied = isCodexBrowserAndComputerUseDenied(sessionId)
  const tools = [
    ...BUILT_IN_SUPERONE_TOOL_DEFS,
    ...(browserAndComputerUseDenied ? [] : getBrowserToolDescriptors()),
    ...getMiniappFixedToolDescriptors() as SuperoneMcpToolDescriptor[],
    WIDGET_LIST_TEMPLATES_DESCRIPTOR,
    WIDGET_SHOW_DESCRIPTOR,
  ]
  // Computer Use is opt-in (default off). P0 exposes the 6-tool contract only when enabled.
  if (!browserAndComputerUseDenied && isComputerUseEnabled()) {
    tools.push(...getComputerUseToolDescriptors())
  }
  // Gated on the platform, not on whether a device is booted: Codex snapshots
  // tools/list once per session, so a surface that appeared when a simulator boots
  // would stay missing for any session that started without one.
  if (isDeviceAgentEnabled()) {
    tools.push(...getDeviceAgentToolDescriptors())
  }
  // Mini-app tools are no longer listed per-app — fixed miniapp_list / miniapp_call only.
  void sessionId
  return tools
}

export async function executeSuperoneMcpTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (
    isCodexBrowserAndComputerUseDenied(sessionId)
    && (isBrowserToolName(toolName) || isComputerUseToolName(toolName))
  ) {
    return {
      content: [{ type: 'text' as const, text: CODEX_MANAGED_BROWSER_COMPUTER_DENIED_MESSAGE }],
      isError: true,
    }
  }

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
    return executeComputerUseTool(sessionId, toolName, args, { signal })
  }

  if (isDeviceAgentToolName(toolName)) {
    if (!isDeviceAgentEnabled()) {
      return {
        content: [{ type: 'text' as const, text: '[Error] Touch-device control needs macOS with Xcode installed.' }],
        isError: true,
      }
    }
    return executeDeviceAgentTool(sessionId, toolName, args, signal)
  }

  if ((BUILT_IN_SUPERONE_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return executeBuiltInSuperoneTool(toolName as BuiltInSuperoneToolName, args, {
      notifyDevAppReady,
      sessionId,
      sessionHost: getSessionHost(),
      applyAppSettings: getAppSettingsApplier(),
      signal,
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

  if (toolName === WIDGET_LIST_TEMPLATES_NAME) {
    const projectPath = getSessionHost()?.getSession(sessionId)?.projectPath
    return listWidgetTemplatesHandler({ projectPath })
  }

  if (toolName === WIDGET_SHOW_NAME) {
    const projectPath = getSessionHost()?.getSession(sessionId)?.projectPath
    return executeWidgetShowTool(args, { projectPath, sessionId })
  }

  throw new Error(`Unknown SuperOne MCP tool: ${toolName}`)
}
