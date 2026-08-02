/**
 * Host Action MCP tool surface (core).
 *
 * Transport-agnostic: both the loopback HTTP adapter and the Claude Agent SDK
 * in-process adapter register tools through this module. Handlers only create
 * Host Actions — desktop executes the real SuperOne tool implementations via
 * `executeSuperoneMcpTool`.
 *
 * Tool discovery schemas come from the shared SuperOne catalog (browser +
 * builtins + computer use + widgets + mobile share) so remote agents see the
 * same names/args as local SuperOne MCP.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  listHostActionSuperoneTools,
  type HostActionReplayPolicy,
  type HostActionTerminalResult,
} from '@superone/shared/environment'
import { jsonSchemaToZodShape } from './json-schema-to-zod'

/** Public MCP server name harnesses attach as. */
export const HOST_ACTION_MCP_NAME = 'superone'

export type HostActionRequestFn = (input: {
  sessionId: string
  toolName: string
  toolGroup: string
  args: unknown
  replayPolicy: HostActionReplayPolicy
  deadlineMs?: number
  signal?: AbortSignal
}) => Promise<HostActionTerminalResult>

export function terminalToMcpContent(terminal: HostActionTerminalResult): {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
} {
  if (terminal.state === 'succeeded') {
    // Prefer desktop tool reply shape when present.
    const r = terminal.result
    if (r && typeof r === 'object' && Array.isArray((r as { content?: unknown }).content)) {
      return r as { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(terminal.result ?? null) }],
    }
  }
  const err =
    terminal.error ??
    (terminal.state === 'cancelled'
      ? { code: 'cancelled', message: 'host action cancelled' }
      : { code: 'failed', message: 'host action failed' })
  return {
    content: [{ type: 'text', text: typeof err === 'string' ? err : JSON.stringify(err) }],
    isError: true,
  }
}

/**
 * Create an McpServer with the full Host Action SuperOne tool surface for one session.
 * Used by HTTP transport sessions and Claude SDK in-process adapters.
 */
export function createHostActionMcpServer(
  superoneSessionId: string,
  requestHostAction: HostActionRequestFn,
): McpServer {
  const server = new McpServer({ name: 'superone-host-action', version: '1.0.0' })
  registerHostActionTools(server, superoneSessionId, requestHostAction)
  return server
}

export function registerHostActionTools(
  server: McpServer,
  superoneSessionId: string,
  requestHostAction: HostActionRequestFn,
): void {
  for (const tool of listHostActionSuperoneTools()) {
    const inputSchema = jsonSchemaToZodShape(tool.inputSchema)
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
        ...(tool._meta ? { _meta: tool._meta } : {}),
      },
      async (args, extra) => {
        const terminal = await requestHostAction({
          sessionId: superoneSessionId,
          toolName: tool.name,
          toolGroup: tool.toolGroup,
          args: args ?? {},
          replayPolicy: tool.replayPolicy,
          signal: extra?.signal,
        })
        return terminalToMcpContent(terminal)
      },
    )
  }
}
