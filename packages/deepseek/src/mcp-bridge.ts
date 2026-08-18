import type { Context } from '@deepseek-ai/cordis'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export interface DeepseekMcpBridgeOptions {
  /** Namespace for the model-facing names: `mcp__<serverName>__<rawName>`. */
  serverName: string
  url: string
  /** Per-session auth — the reason this connection cannot be shared. */
  headers: Record<string, string>
  toolCallTimeoutMs?: number
  /**
   * Transport factory. Defaults to Streamable HTTP against `url` + `headers`;
   * override to reach a server over another transport (and in tests, to link
   * an in-memory pair instead of standing up an HTTP listener).
   */
  createTransport?: () => Transport
}

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** DeepSeek function-name contract, enforced on the public name we mint. */
const MAX_PUBLIC_NAME_LENGTH = 64
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
}

/**
 * Bridge one MCP server onto a single dsh agent's tool scope.
 *
 * Why not `@deepseek-ai/dsh-mcp-client`: it reserves `serverName` on `ctx.root`,
 * which every context in the app shares, so the second session mounting
 * `superone` throws at activation. Varying the name per session is not an
 * option either — `mcp__superone__*` is a contract on the SuperOne side
 * (host-owned tool admission, hidden tool rows, mini-app dispatch all match on
 * it). Registering the tools ourselves under the agent's scoped context keeps
 * one connection (and its per-session token) per agent, with the public names
 * fixed.
 *
 * Everything here is contained: a failed handshake or a rejected registration
 * costs the session its MCP tools, never its creation.
 */
export async function mountMcpBridge(
  agentCtx: Context,
  options: DeepseekMcpBridgeOptions,
): Promise<void> {
  const client = new Client({ name: 'superone', version: '1.0.0' })
  await client.connect(options.createTransport?.() ?? new StreamableHTTPClientTransport(
    new URL(options.url),
    { requestInit: { headers: options.headers } },
  ) as Transport)
  // Tie the connection to the agent scope: disposing the agent closes it.
  agentCtx.effect(() => () => { void client.close() })

  const timeout = options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS
  const registry = agentCtx as Context & {
    tools: { register(definition: unknown): () => void }
    logger?: { warn(message: string): void }
  }

  for (const tool of await listTools(client)) {
    const publicName = publicToolName(options.serverName, tool.name)
    try {
      registry.tools.register({
        name: publicName,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
        output: {
          // Deliberately not the server's advertised outputSchema: dsh
          // validates this one, and an MCP server may advertise vocabulary dsh
          // does not implement. The canonical envelope always validates.
          schema: {
            type: 'object',
            properties: { content: { type: 'array', items: {} }, structuredContent: {} },
            required: ['content'],
            additionalProperties: false,
          },
          render: (_args: unknown, value: unknown) => [{
            type: 'text',
            text: extractText((value as { content?: unknown[] }).content ?? [], tool.name),
          }],
        },
        execute: async (args: unknown, exec: { signal?: AbortSignal }) => {
          // A misbehaving model can emit a bare string; `{}` lets the server
          // answer with its own "missing required parameter" the model can act on.
          const argumentsObject = args && typeof args === 'object' && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {}
          const result = await client.request(
            { method: 'tools/call', params: { name: tool.name, arguments: argumentsObject } },
            CallToolResultSchema,
            { ...(exec.signal ? { signal: exec.signal } : {}), timeout },
          )
          const content = (result.content ?? []) as unknown[]
          // MCP `isError` must throw so the tool runtime marks the result as an
          // error for the model instead of presenting a failure as output.
          if (result.isError === true) throw new Error(extractText(content, tool.name))
          return {
            content,
            ...(result.structuredContent !== undefined
              ? { structuredContent: result.structuredContent }
              : {}),
          }
        },
      })
    } catch (error) {
      // One unusable tool must not cost the session the rest of the surface.
      registry.logger?.warn(`superone-mcp: skipped tool "${publicName}": ${String(error)}`)
    }
  }
}

/** Drain `tools/list` pagination. */
async function listTools(client: Client): Promise<Array<{
  name: string
  description?: string
  inputSchema: unknown
}>> {
  const tools: Array<{ name: string; description?: string; inputSchema: unknown }> = []
  let cursor: string | undefined
  do {
    const page = await client.request(
      { method: 'tools/list', ...(cursor === undefined ? {} : { params: { cursor } }) },
      ListToolsResultSchema,
    )
    tools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

/**
 * `mcp__<serverName>__<rawName>`, normalized to the DeepSeek function-name
 * contract. Truncation appends nothing: SuperOne owns both sides of this
 * server, its names are short and already legal, and a silent rename would
 * break the qualified-name matching the host-owned admission rules do.
 */
export function publicToolName(serverName: string, rawName: string): string {
  return `mcp__${serverName}__${rawName}`
    .replace(INVALID_NAME_CHARS, '_')
    .slice(0, MAX_PUBLIC_NAME_LENGTH)
}

/** MCP content → the one text projection the model sees. */
export function extractText(content: readonly unknown[], toolName: string): string {
  const parts: string[] = []
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]')
      continue
    }
    const block = value as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) parts.push(block.text)
        break
      case 'image':
      case 'audio':
        parts.push(`[${block.type}: ${block.mimeType ?? 'unknown'}, content discarded]`)
        break
      case 'resource':
      case 'resource_link':
        parts.push('[resource: content discarded]')
        break
      default:
        parts.push(`[unsupported content type: ${block.type}]`)
    }
  }
  return parts.join('\n') || `(${toolName} returned no text content)`
}
