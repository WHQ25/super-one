import { logToolFailure } from './tool-error-log'
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
  getTerminalToolDeps,
  miniappToolDepsForSurface,
  notifyDevAppReady,
} from './superone-mcp-server'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'
import { WIDGET_SHOW_DESCRIPTION } from '@superone/shared/generative-ui/widget-tool-descriptions'
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
import { abandonHeldDeliveries, collectArtifacts, takeArtifacts, takeHeldDeliveries, type ArtifactRef } from './artifact-registry'
import type { DeliveryHandle } from '../db-session-deliveries'
import { randomUUID } from 'node:crypto'

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
  description: WIDGET_SHOW_DESCRIPTION,
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

/**
 * `executeSuperoneMcpTool` plus the artifact refs the call registered
 * (session-sync-zone.md §3). The Host Action executor uses this so it can push
 * a remote session's outputs to the node before the reply goes back; local
 * callers keep the plain result.
 */
const markedZoneOwners = new Set<string>()

export async function executeSuperoneMcpToolCollecting(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  connectionId?: string,
): Promise<{ result: Awaited<ReturnType<typeof executeSuperoneMcpTool>>; artifacts: ArtifactRef[]; held: Map<string, DeliveryHandle> }> {
  const callId = randomUUID()
  // Record which side owns this session's zone directory, so the reclaim sweep
  // can ask the right one whether the session still exists (§7). Once per
  // (session, connection) per process — the marker does not change after that.
  const ownerKey = `${sessionId}\u0000${connectionId ?? 'local'}`
  if (!markedZoneOwners.has(ownerKey)) {
    markedZoneOwners.add(ownerKey)
    void import('../environment/session-zone-reclaim')
      .then((m) => m.markZoneOwner(sessionId, connectionId && connectionId !== 'local' ? connectionId : null))
      .catch(() => markedZoneOwners.delete(ownerKey))
  }
  try {
    const result = await collectArtifacts(
      sessionId,
      callId,
      () => executeSuperoneMcpTool(sessionId, toolName, args, signal, connectionId),
      connectionId,
    )
    // Drain the held deliveries first, then the refs: the reply-selection is
    // handed the live handles so the worker can never take an undecided file in
    // the gap between here and the selection (E090-4).
    const held = takeHeldDeliveries(sessionId, callId)
    const artifacts = takeArtifacts(sessionId, callId)
    return { result, artifacts, held: new Map(held.filter((h) => h.deliveryId).map((h) => [h.deliveryId, h])) }
  } finally {
    // A call that threw after registering must not leave its scope behind. On
    // the success path both takes are empty — the caller already drained them
    // and owns the deliveries. Here they are not: this call OWNS its held rows,
    // so a thrown tool abandons them. The refs are only drained to free the
    // scope — a ref WITHOUT a held handle is an observation of someone else's
    // delivery (a page or background download the worker has not yet carried),
    // never this call's to abandon (E090-4).
    abandonHeldDeliveries(takeHeldDeliveries(sessionId, callId))
    takeArtifacts(sessionId, callId)
  }
}

/** Dispatch one tool call outside the McpServer instance (stdio bridge, DeepSeek, Host Actions). */
export function executeSuperoneMcpTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  /**
   * Owning remote connection when this runs as a Host Action. Only the
   * files-previewer widget uses it — to reach the node session's live cwd and
   * stat its files where they live (inline-files-previewer.md §2.2).
   */
  connectionId?: string,
) {
  return logToolFailure(sessionId, toolName, () => runSuperoneMcpTool(sessionId, toolName, args, signal, connectionId))
}

async function runSuperoneMcpTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  connectionId: string | undefined,
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
      terminals: getTerminalToolDeps(),
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
    const session = getSessionHost()?.getSession(sessionId)
    const projectPath = session?.projectPath
    return executeWidgetShowTool(args, {
      projectPath,
      sessionId,
      resolveSessionRoot: () => getSessionHost()?.getSession(sessionId)?.cwd || projectPath,
      // A remote Host Action has no local SessionManager entry; the previewer's
      // context comes from the owning node instead (inline-files-previewer.md §2.2).
      resolvePreviewerContext:
        connectionId && connectionId !== 'local' && !session
          ? async () => {
              const { resolveRemotePreviewerContext } = await import('../environment/files-previewer-context')
              return resolveRemotePreviewerContext(connectionId, sessionId)
            }
          : undefined,
    })
  }

  throw new Error(`Unknown SuperOne MCP tool: ${toolName}`)
}
