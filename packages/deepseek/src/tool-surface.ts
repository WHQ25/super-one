import type { Context } from '@deepseek-ai/cordis'

export interface SuperoneToolDescriptor {
  name: string
  description: string
  /** JSON Schema, passed to dsh verbatim. */
  inputSchema: unknown
}

export interface SuperoneToolResult {
  content: readonly unknown[]
  isError?: boolean
  structuredContent?: unknown
}

/**
 * SuperOne's own tool plane, injected rather than imported: this package must
 * stay free of Electron-main code, and the same seam serves a remote node.
 */
export interface SuperoneToolSurface {
  /** The tools this session may see right now (feature gates are per session). */
  list: () => SuperoneToolDescriptor[]
  call: (
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ) => Promise<SuperoneToolResult>
  /**
   * Subscribe to tool-set changes for this session (a mini-app registered,
   * Computer Use toggled, a phone subscribed). Returns an unsubscribe.
   */
  onChanged?: (listener: () => void) => () => void
}

/**
 * Prefix kept from the MCP era on purpose. These tools no longer travel over
 * MCP for dsh, but `mcp__superone__<name>` is SuperOne's canonical tool
 * identity: host-owned admission, hidden tool rows, mobile event stripping and
 * mini-app dispatch all match on it, and Claude/Codex/ACP show the same names.
 * A bare name here would be a different tool to every one of those.
 */
const TOOL_NAME_PREFIX = 'mcp__superone__'

export function superoneToolName(bareName: string): string {
  return `${TOOL_NAME_PREFIX}${bareName}`
}

/**
 * Register SuperOne's built-in tools as native dsh tools on one agent's scope.
 *
 * dsh's model is that everything is a plugin, and its tool registry is scoped
 * per agent — so the natural integration is to register our tools directly and
 * execute them in-process. Bridging them over our own MCP server instead would
 * add a transport, a session token, a reconnect policy and a `tools/list_changed`
 * subscription for tools that live in this very process. MCP stays what it is
 * for: third-party servers.
 *
 * Registrations unwind with the agent scope. When the session's tool set
 * changes, the whole generation is replaced — dsh re-assembles the prompt from
 * the registry, so add/remove both take effect on the next request.
 */
export function mountSuperoneTools(agentCtx: Context, surface: SuperoneToolSurface): void {
  const registry = agentCtx as Context & {
    tools: { register(definition: unknown): () => void }
    logger?: { warn(message: string): void }
  }
  let generation: Array<() => void> = []

  const sync = (): void => {
    for (const dispose of generation) dispose()
    generation = []
    for (const tool of surface.list()) {
      try {
        generation.push(registry.tools.register(defineTool(tool, surface)))
      } catch (error) {
        // One unusable descriptor must not cost the session the rest of the surface.
        registry.logger?.warn(`superone-tools: skipped "${tool.name}": ${String(error)}`)
      }
    }
  }

  sync()
  const unsubscribe = surface.onChanged?.(sync)
  agentCtx.effect(() => () => {
    unsubscribe?.()
    for (const dispose of generation) dispose()
    generation = []
  })
}

function defineTool(tool: SuperoneToolDescriptor, surface: SuperoneToolSurface): unknown {
  return {
    name: superoneToolName(tool.name),
    description: tool.description,
    parameters: tool.inputSchema,
    output: {
      // The canonical envelope, not a per-tool schema: dsh validates this one at
      // register() and SuperOne tools answer in MCP content blocks.
      schema: {
        type: 'object',
        properties: { content: { type: 'array', items: {} }, structuredContent: {} },
        required: ['content'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown) => [{
        type: 'text',
        text: extractText((value as { content?: readonly unknown[] }).content ?? [], tool.name),
      }],
    },
    execute: async (args: unknown, exec: { signal?: AbortSignal }) => {
      // A misbehaving model can emit a bare string; `{}` lets the tool answer
      // with its own "missing required parameter" the model can act on.
      const argumentsObject = args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {}
      const result = await surface.call(tool.name, argumentsObject, {
        ...(exec.signal ? { signal: exec.signal } : {}),
      })
      const content = result.content ?? []
      // Throwing is what marks the result as an error for the model; returning
      // the text would present a failure as ordinary output.
      if (result.isError === true) throw new Error(extractText(content, tool.name))
      return {
        content,
        ...(result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent }
          : {}),
      }
    },
  }
}

interface ToolContentBlock {
  type: string
  text?: string
  mimeType?: string
}

/** MCP-shaped content → the one text projection the model sees. */
export function extractText(content: readonly unknown[], toolName: string): string {
  const parts: string[] = []
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]')
      continue
    }
    const block = value as ToolContentBlock
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
