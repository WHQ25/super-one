import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  HOST_ACTION_MCP_APP_DESCRIPTORS,
  MCP_APP_TOOLS_CALL_TOOL_NAME,
  MCP_APP_TOOLS_LIST_TOOL_NAME,
} from '@superone/shared/environment/host-action-mcp-app-descriptors'
import { sessionKey as toSessionKey, sessionRef } from '@superone/shared/environment/refs'
import { MCP_APP_TOOL_NAMES } from '@superone/shared/superone-host-owned-tools'
import {
  summarizeMcpAppRegisteredTool,
  type McpAppRegisteredTool,
} from '@superone/shared/mcp-app-tools'
import { getMcpAppToolsRegistry, type McpAppToolsRegistry } from '../mcp-apps/app-tools-registry'
import { currentHostActionConnection } from './artifact-registry'
import { jsonSchemaToZodShape } from './json-schema-zod'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'

export type McpAppMcpReply = {
  content: CallToolResult['content']
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface McpAppToolsMcpDeps {
  registry?: McpAppToolsRegistry
  resolvePermissionMode?: (sessionId: string, connectionId: string) => Promise<string | null | undefined> | string | null | undefined
}

function textReply(data: unknown): McpAppMcpReply {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

function errorReply(error: unknown): McpAppMcpReply {
  return {
    content: [{ type: 'text', text: `[Error] ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  }
}

function schemaErrorReply(details: {
  viewId: string
  tool: string
  issues: Array<{ path: string; message: string }>
}): McpAppMcpReply {
  const issueText = details.issues
    .map((issue) => `  - ${issue.path || '(root)'}: ${issue.message}`)
    .join('\n')
  return {
    content: [{
      type: 'text',
      text: [
        `[Error] Invalid input for mcp_app_tools_call viewId=${details.viewId} tool=${details.tool}.`,
        'Fix the fields below and retry:',
        issueText || '  - (unknown validation failure)',
      ].join('\n'),
    }],
    isError: true,
  }
}

function fullToolPayload(tool: McpAppRegisteredTool) {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool.schemaFallback ? { schemaFallback: true } : {}),
  }
}

function resolveScopedSessionKey(sessionId: string, connectionId?: string): { sessionKey: string; connectionId: string } {
  const effectiveConnection = connectionId && connectionId !== 'local'
    ? connectionId
    : (currentHostActionConnection() ?? 'local')
  return {
    sessionKey: toSessionKey(sessionRef(effectiveConnection, sessionId)),
    connectionId: effectiveConnection,
  }
}

function formatArgsPreview(input: Record<string, unknown>): string {
  const keys = Object.keys(input)
  if (keys.length === 0) return '{}'
  const raw = JSON.stringify(input, null, 2)
  return raw.length > 4096 ? `${raw.slice(0, 4096)}\n…` : raw
}

export function isMcpAppToolName(toolName: string): boolean {
  return (MCP_APP_TOOL_NAMES as readonly string[]).includes(toolName)
}

export function getMcpAppToolDescriptors(): SuperoneMcpToolDescriptor[] {
  return HOST_ACTION_MCP_APP_DESCRIPTORS
}

export async function executeMcpAppToolsList(
  sessionId: string,
  args: { viewId?: string; includeSchema?: boolean },
  deps: McpAppToolsMcpDeps = {},
  connectionId?: string,
): Promise<McpAppMcpReply> {
  try {
    const registry = deps.registry ?? getMcpAppToolsRegistry()
    const { sessionKey } = resolveScopedSessionKey(sessionId, connectionId)
    const viewId = typeof args.viewId === 'string' && args.viewId.trim() ? args.viewId.trim() : undefined

    if (viewId) {
      const view = registry.getView(sessionKey, viewId)
      if (!view) {
        return errorReply(
          new Error(
            `MCP App View "${viewId}" is not currently mounted in this session. Call mcp_app_tools_list without viewId to see open Views.`,
          ),
        )
      }
      const includeSchema = args.includeSchema !== false
      return textReply({
        viewId: view.viewId,
        server: view.server,
        ...(view.viewTitle ? { viewTitle: view.viewTitle } : {}),
        tools: includeSchema ? view.tools.map(fullToolPayload) : view.tools.map(summarizeMcpAppRegisteredTool),
      })
    }

    const views = registry.listSessionViews(sessionKey)
    const includeSchema = args.includeSchema === true
    return textReply({
      count: views.length,
      views: views.map((view) => ({
        viewId: view.viewId,
        server: view.server,
        ...(view.viewTitle ? { viewTitle: view.viewTitle } : {}),
        tools: includeSchema ? view.tools.map(fullToolPayload) : view.tools.map(summarizeMcpAppRegisteredTool),
      })),
    })
  } catch (error) {
    return errorReply(error)
  }
}

export async function executeMcpAppToolsCall(
  sessionId: string,
  args: { viewId: string; tool: string; input?: Record<string, unknown>; description?: string },
  deps: McpAppToolsMcpDeps = {},
  signal?: AbortSignal,
  connectionId?: string,
): Promise<McpAppMcpReply> {
  try {
    const viewId = typeof args.viewId === 'string' ? args.viewId.trim() : ''
    const toolName = typeof args.tool === 'string' ? args.tool.trim() : ''
    if (!viewId || !toolName) {
      return errorReply(new Error('mcp_app_tools_call requires string fields viewId and tool'))
    }
    const rawInput = args.input && typeof args.input === 'object' && !Array.isArray(args.input)
      ? args.input
      : {}

    const registry = deps.registry ?? getMcpAppToolsRegistry()
    const { sessionKey, connectionId: effectiveConnection } = resolveScopedSessionKey(sessionId, connectionId)
    const view = registry.getView(sessionKey, viewId)
    if (!view) {
      return errorReply(
        new Error(
          `MCP App View "${viewId}" is not currently mounted in this session. Call mcp_app_tools_list to see open Views.`,
        ),
      )
    }

    const toolDef = view.tools.find((candidate) => candidate.name === toolName)
    if (!toolDef) {
      const available = view.tools.map((candidate) => candidate.name).join(', ') || '(none)'
      return errorReply(
        new Error(
          `Unknown tool "${toolName}" on MCP App View "${viewId}". Available tools: ${available}. Call mcp_app_tools_list({ viewId: "${viewId}" }) for definitions.`,
        ),
      )
    }

    let validatedInput = rawInput
    if (!toolDef.schemaFallback) {
      const zodShape = jsonSchemaToZodShape(toolDef.inputSchema)
      const parsed = z.object(zodShape).passthrough().safeParse(rawInput)
      if (!parsed.success) {
        return schemaErrorReply({
          viewId,
          tool: toolName,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
            message: issue.message,
          })),
        })
      }
      validatedInput = parsed.data as Record<string, unknown>
    }

    const permissionMode = await deps.resolvePermissionMode?.(sessionId, effectiveConnection)
    const bypassApproval = permissionMode === 'bypassPermissions'

    const outcome = await registry.invokeTool({
      sessionKey,
      viewId,
      toolName,
      args: validatedInput,
      argsPreview: formatArgsPreview(validatedInput),
      bypassApproval,
      signal,
    })

    if (outcome.status !== 'executed') {
      return textReply({
        status: outcome.status,
        viewId,
        tool: toolName,
        hint: 'The user did not approve this MCP App tool. Do not retry without their instruction.',
      })
    }

    return {
      content: outcome.result.content as CallToolResult['content'],
      ...(outcome.result.structuredContent && typeof outcome.result.structuredContent === 'object' && !Array.isArray(outcome.result.structuredContent)
        ? { structuredContent: outcome.result.structuredContent as Record<string, unknown> }
        : {}),
      ...(outcome.result.isError ? { isError: true } : {}),
    }
  } catch (error) {
    return errorReply(error)
  }
}

export function executeMcpAppFixedTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  deps: McpAppToolsMcpDeps = {},
  signal?: AbortSignal,
  connectionId?: string,
): Promise<McpAppMcpReply> | null {
  switch (toolName) {
    case MCP_APP_TOOLS_LIST_TOOL_NAME:
      return executeMcpAppToolsList(
        sessionId,
        {
          viewId: typeof args.viewId === 'string' ? args.viewId : undefined,
          includeSchema: typeof args.includeSchema === 'boolean' ? args.includeSchema : undefined,
        },
        deps,
        connectionId,
      )
    case MCP_APP_TOOLS_CALL_TOOL_NAME:
      return executeMcpAppToolsCall(
        sessionId,
        {
          viewId: typeof args.viewId === 'string' ? args.viewId : '',
          tool: typeof args.tool === 'string' ? args.tool : '',
          input: args.input && typeof args.input === 'object' && !Array.isArray(args.input) ? args.input as Record<string, unknown> : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
        },
        deps,
        signal,
        connectionId,
      )
    default:
      return null
  }
}

export function registerMcpAppTools(
  server: McpServer,
  sessionId: string,
  deps: McpAppToolsMcpDeps = {},
): void {
  for (const descriptor of HOST_ACTION_MCP_APP_DESCRIPTORS) {
    server.registerTool(
      descriptor.name,
      { description: descriptor.description, inputSchema: jsonSchemaToZodShape(descriptor.inputSchema) },
      async (raw, extra) => executeMcpAppFixedTool(
        sessionId,
        descriptor.name,
        raw as Record<string, unknown>,
        deps,
        extra.signal,
      )!,
    )
  }
}
