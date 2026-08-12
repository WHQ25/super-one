import type { SDKCustomTool, SDKJsonValue } from '@cursor/sdk'

/**
 * Host-owned custom tools exposed to Cursor local agents as the
 * `custom-user-tools` MCP server (SDK LocalAgentOptions.customTools).
 *
 * SuperOne's full tool surface still arrives via the SuperOne stdio MCP
 * (see cursor-mcp.ts). These in-process tools cover lightweight host metadata
 * that does not need another process hop, and act as a stable extension point
 * for future host bridges.
 */
export function buildCursorCustomTools(ctx: {
  sessionId: string
  cwd: string
}): Record<string, SDKCustomTool> {
  return {
    superone_session_info: {
      description:
        'Return SuperOne host session metadata (session id, project cwd). Prefer SuperOne MCP tools for project actions.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => ({
        sessionId: ctx.sessionId,
        cwd: ctx.cwd,
        host: 'superone',
      }) as Record<string, SDKJsonValue>,
    },
  }
}
