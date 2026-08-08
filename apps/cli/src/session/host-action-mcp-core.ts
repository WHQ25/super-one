/**
 * Host Action MCP tool surface (core).
 *
 * Transport-agnostic: both the loopback HTTP adapter and the Claude Agent SDK
 * in-process adapter register tools through this module.
 *
 * - Desktop-bound tools create Host Actions via `requestHostAction`.
 * - Node-local session_collab_* tools call CollaborationService in-process
 *   (no Host Action claim on the desktop).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS,
  isNodeLocalSuperoneTool,
  listHostActionSuperoneTools,
  type HostActionReplayPolicy,
  type HostActionTerminalResult,
} from '@superone/shared/environment'
import { z } from 'zod'
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

/** Node-local collab handlers (SessionRuntime CollaborationService). */
export interface NodeCollabToolHandlers {
  listAgents: (sessionId: string) => Promise<unknown> | unknown
  request: (
    sessionId: string,
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<unknown>
  start: (sessionId: string, args: unknown) => Promise<unknown>
  send: (sessionId: string, args: unknown) => Promise<unknown>
  retrieve: (sessionId: string, args: unknown) => Promise<unknown>
}

export interface CreateHostActionMcpServerOptions {
  collab?: NodeCollabToolHandlers
}

function toolResultJson(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

function collabErrorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? 'failed')
      : 'failed'
  return toolResultJson({ status: 'error', code, message }, true)
}

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
 * Create an McpServer with Host Action SuperOne tools + optional node-local collab.
 * Used by HTTP transport sessions and Claude SDK in-process adapters.
 */
export function createHostActionMcpServer(
  superoneSessionId: string,
  requestHostAction: HostActionRequestFn,
  opts?: CreateHostActionMcpServerOptions,
): McpServer {
  const server = new McpServer({ name: 'superone-host-action', version: '1.0.0' })
  registerHostActionTools(server, superoneSessionId, requestHostAction)
  if (opts?.collab) {
    registerNodeCollabTools(server, superoneSessionId, opts.collab)
  }
  return server
}

export function registerHostActionTools(
  server: McpServer,
  superoneSessionId: string,
  requestHostAction: HostActionRequestFn,
): void {
  for (const tool of listHostActionSuperoneTools()) {
    // Defensive: catalog already excludes node-local tools.
    if (isNodeLocalSuperoneTool(tool.name)) continue
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

function collabDescriptor(name: string): {
  description: string
  inputSchema: Record<string, unknown>
} {
  const d = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((x) => x.name === name)
  return {
    description: d?.description ?? name,
    inputSchema: d?.inputSchema ?? { type: 'object', properties: {} },
  }
}

/**
 * Register session_collab_* as in-process tools (node SessionRuntime).
 * Collaboration is always available; user approval still gates child launches.
 */
export function registerNodeCollabTools(
  server: McpServer,
  superoneSessionId: string,
  collab: NodeCollabToolHandlers,
): void {
  const listDesc = collabDescriptor('session_collab_list_agents')
  server.registerTool(
    'session_collab_list_agents',
    {
      description: listDesc.description,
      inputSchema: {},
    },
    async () => {
      try {
        const agents = await collab.listAgents(superoneSessionId)
        return toolResultJson({ agents })
      } catch (err) {
        return collabErrorResult(err)
      }
    },
  )

  const reqDesc = collabDescriptor('session_collab_request')
  server.registerTool(
    'session_collab_request',
    {
      description: reqDesc.description,
      inputSchema: jsonSchemaToZodShape(reqDesc.inputSchema),
    },
    async (args, extra) => {
      try {
        const result = await collab.request(superoneSessionId, args ?? {}, extra?.signal)
        const status =
          result && typeof result === 'object' && 'status' in result
            ? String((result as { status: unknown }).status)
            : 'ok'
        // cancelled/rejected are structured outcomes for the agent (not transport errors).
        return toolResultJson(result, status === 'error')
      } catch (err) {
        return collabErrorResult(err)
      }
    },
  )

  const startDesc = collabDescriptor('session_collab_start')
  server.registerTool(
    'session_collab_start',
    {
      description: startDesc.description,
      inputSchema: {
        credential: z.string().min(1),
      },
    },
    async (args) => {
      try {
        const result = await collab.start(superoneSessionId, args ?? {})
        return toolResultJson(result)
      } catch (err) {
        return collabErrorResult(err)
      }
    },
  )

  const sendDesc = collabDescriptor('session_collab_send')
  server.registerTool(
    'session_collab_send',
    {
      description: sendDesc.description,
      inputSchema: jsonSchemaToZodShape(sendDesc.inputSchema),
    },
    async (args) => {
      try {
        const result = await collab.send(superoneSessionId, args ?? {})
        return toolResultJson(result)
      } catch (err) {
        return collabErrorResult(err)
      }
    },
  )

  const retrieveDesc = collabDescriptor('session_collab_retrieve')
  server.registerTool(
    'session_collab_retrieve',
    {
      description: retrieveDesc.description,
      inputSchema: jsonSchemaToZodShape(retrieveDesc.inputSchema),
    },
    async (args) => {
      try {
        const result = await collab.retrieve(superoneSessionId, args ?? {})
        return toolResultJson(result)
      } catch (err) {
        return collabErrorResult(err)
      }
    },
  )
}
