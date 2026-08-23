/**
 * Fixed mini-app MCP surface: miniapp_list + miniapp_call.
 *
 * Precedent: browser-action-mcp-tools.ts (list / do with opaque input record).
 * Per-app tools are no longer registered on the MCP server — authorization is
 * session-scoped via registerAppTools cache; agents discover tools via miniapp_list.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import { jsonSchemaToZodShape } from './json-schema-zod'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  MINIAPP_CALL_TOOL_NAME,
  MINIAPP_LIST_TOOL_NAME,
  parseMiniappCallArgs,
} from './miniapp-call-policy'
import { awaitMiniappCallConfirm } from './miniapp-call-confirm'

export type MiniappToolReply = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export function miniappTextReply(data: unknown): MiniappToolReply {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

export function miniappErrorReply(err: unknown): MiniappToolReply {
  return {
    content: [{ type: 'text', text: `[Error] ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  }
}

/** Model-readable validation error matching browser_action_do style (field + expected). */
export function miniappSchemaErrorReply(details: {
  appId: string
  tool: string
  issues: Array<{ path: string; message: string }>
}): MiniappToolReply {
  const issueText = details.issues
    .map((i) => `  - ${i.path || '(root)'}: ${i.message}`)
    .join('\n')
  return {
    content: [{
      type: 'text',
      text: [
        `[Error] Invalid input for miniapp_call appId=${details.appId} tool=${details.tool}.`,
        'Fix the fields below and retry:',
        issueText || '  - (unknown validation failure)',
      ].join('\n'),
    }],
    isError: true,
  }
}

export interface MiniappToolDeps {
  getAuthorizedApps(sessionId: string): Array<{
    appId: string
    tools: MiniAppToolDefinition[]
  }>
  getAppEntry(sessionId: string, appId: string): {
    projectDir: string
    tools: MiniAppToolDefinition[]
  } | null
  dispatchAppToolCall(
    sessionId: string,
    projectDir: string,
    appId: string,
    toolName: string,
    isStandalone: boolean,
    args: Record<string, unknown>,
  ): Promise<unknown>
  /** Args-aware preapprove (install preapproved.json + alwaysAllow updates). */
  isAppToolPreapproved(appId: string, toolName: string): boolean
  /** Persist alwaysAllow for the rest of the process. */
  markAppToolPreapproved(appId: string, toolName: string): void
  /**
   * Host event emitter for the SuperOne session. When null, non-preapproved
   * calls hard-deny (same as video_gen without a session).
   */
  getEmitHostEvent(sessionId: string): ((event: AgentEvent) => void) | null
}

function summarizeTool(t: MiniAppToolDefinition): { name: string; description: string; standalone?: boolean } {
  const base = t.description
  const description = t.standalone
    ? base
    : `${base}\n\n(Note: this tool requires the mini-app's panel UI to be open to execute.)`
  return {
    name: t.name,
    description: description.split('\n')[0] ?? description,
    ...(t.standalone ? { standalone: true } : {}),
  }
}

function fullToolDef(t: MiniAppToolDefinition): MiniAppToolDefinition {
  return t
}

export async function executeMiniappList(
  sessionId: string,
  args: { appId?: string; includeSchema?: boolean },
  deps: MiniappToolDeps,
): Promise<MiniappToolReply> {
  try {
    const authorized = deps.getAuthorizedApps(sessionId)
    if (args.appId) {
      const entry = authorized.find((a) => a.appId === args.appId)
      if (!entry) {
        return miniappErrorReply(
          new Error(
            `App "${args.appId}" is not authorized for this session. Call miniapp_list without appId to see authorized apps.`,
          ),
        )
      }
      const tools = args.includeSchema === false
        ? entry.tools.map(summarizeTool)
        : entry.tools.map(fullToolDef)
      return miniappTextReply({
        appId: entry.appId,
        tools,
      })
    }

    return miniappTextReply({
      count: authorized.length,
      apps: authorized.map((entry) => ({
        appId: entry.appId,
        tools: entry.tools.map(summarizeTool),
      })),
    })
  } catch (err) {
    return miniappErrorReply(err)
  }
}

export async function executeMiniappCall(
  sessionId: string,
  args: { appId: string; tool: string; input?: Record<string, unknown> },
  deps: MiniappToolDeps,
): Promise<MiniappToolReply> {
  try {
    const { appId, tool, toolInput } = parseMiniappCallArgs({
      appId: args.appId,
      tool: args.tool,
      input: args.input ?? {},
    })
    if (!appId || !tool) {
      return miniappErrorReply(new Error('miniapp_call requires string fields appId and tool'))
    }

    const entry = deps.getAppEntry(sessionId, appId)
    if (!entry) {
      return miniappErrorReply(
        new Error(
          `App "${appId}" is not authorized in this session. Call miniapp_list to see authorized apps, or ask the user to @-mention / open the app.`,
        ),
      )
    }

    const toolDef = entry.tools.find((t) => t.name === tool)
    if (!toolDef) {
      const available = entry.tools.map((t) => t.name).join(', ') || '(none)'
      return miniappErrorReply(
        new Error(
          `Unknown tool "${tool}" for app "${appId}". Available tools: ${available}. Call miniapp_list({ appId: "${appId}" }) for full definitions.`,
        ),
      )
    }

    // Schema validation moved into the dispatcher (MCP SDK no longer sees per-tool schemas).
    // passthrough: keep undeclared keys (mini-app tools often accept open bags) while still
    // enforcing required/typed declared fields.
    const zodShape = jsonSchemaToZodShape(toolDef.inputSchema ?? { type: 'object', properties: {} })
    const schema = z.object(zodShape).passthrough()
    const parsed = schema.safeParse(toolInput)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
        message: issue.message,
      }))
      return miniappSchemaErrorReply({ appId, tool, issues })
    }

    // Authoritative permission decision lives here (all harnesses statically admit
    // miniapp_call). Preapproved → run; else host permission_request (session-level).
    if (!deps.isAppToolPreapproved(appId, tool)) {
      const emit = deps.getEmitHostEvent(sessionId)
      if (!emit) {
        return miniappErrorReply(
          new Error(
            `Tool "${tool}" on app "${appId}" is not preapproved and no session is available to prompt the user. Ask the user to preapprove the tool or open this chat again.`,
          ),
        )
      }
      let outcome: Awaited<ReturnType<typeof awaitMiniappCallConfirm>>
      try {
        outcome = await awaitMiniappCallConfirm({
          emitHostEvent: emit,
          appId,
          tool,
          toolInput: parsed.data as Record<string, unknown>,
          toolDisplayName: toolDef.displayName ?? tool,
        })
      } catch (err) {
        return miniappErrorReply(err)
      }
      if (outcome.action !== 'accept') {
        return miniappTextReply({
          status: outcome.action === 'cancel' ? 'cancelled' : 'denied',
          appId,
          tool,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          hint: 'The user did not approve this mini-app tool. Do not retry without their instruction.',
        })
      }
      if (outcome.alwaysAllow) {
        deps.markAppToolPreapproved(appId, tool)
      }
    }

    const result = await deps.dispatchAppToolCall(
      sessionId,
      entry.projectDir,
      appId,
      tool,
      toolDef.standalone === true,
      parsed.data as Record<string, unknown>,
    )
    return miniappTextReply(result)
  } catch (err) {
    return miniappErrorReply(err)
  }
}

export function registerMiniappTools(
  server: McpServer,
  sessionId: string,
  deps: MiniappToolDeps,
): void {
  server.registerTool(
    MINIAPP_LIST_TOOL_NAME,
    {
      description:
        'List mini-apps authorized for this session and their tools. Omit appId for a compact catalog (tool names + one-line descriptions). Pass appId to inspect one app; includeSchema defaults true for that app\'s full tool definitions including inputSchema. Call this before miniapp_call when you do not know the tool names or parameters.',
      inputSchema: {
        appId: z.string().optional().describe('Optional mini-app id. When set, returns that app\'s tools only.'),
        includeSchema: z
          .boolean()
          .optional()
          .describe('When appId is set, include full tool definitions with inputSchema (default true). Ignored when listing all apps.'),
      },
    },
    async (raw) => executeMiniappList(sessionId, {
      appId: typeof raw.appId === 'string' ? raw.appId : undefined,
      includeSchema: typeof raw.includeSchema === 'boolean' ? raw.includeSchema : undefined,
    }, deps),
  )

  server.registerTool(
    MINIAPP_CALL_TOOL_NAME,
    {
      description:
        'Execute a tool on a session-authorized mini-app. Pass appId + tool name from miniapp_list, and tool arguments as input. Panel open/close is implicit: non-standalone tools lazy-open the panel; standalone tools run without a panel. Do not invent tools — call miniapp_list first when unsure.',
      inputSchema: {
        appId: z.string().describe('Mini-app id (from miniapp_list or user @-mention).'),
        tool: z.string().describe('Tool name declared by that app\'s manifest.'),
        input: z
          .record(z.string(), z.unknown())
          .default({})
          .describe('Arguments for the app tool. Validated against the tool\'s inputSchema at dispatch time.'),
      },
    },
    async (raw) => executeMiniappCall(sessionId, {
      appId: String(raw.appId ?? ''),
      tool: String(raw.tool ?? ''),
      input: (raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input))
        ? raw.input as Record<string, unknown>
        : {},
    }, deps),
  )
}

export function getMiniappFixedToolDescriptors(): Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}> {
  return [
    {
      name: MINIAPP_LIST_TOOL_NAME,
      description:
        'List mini-apps authorized for this session and their tools. Omit appId for a compact catalog (tool names + one-line descriptions). Pass appId to inspect one app; includeSchema defaults true for that app\'s full tool definitions including inputSchema. Call this before miniapp_call when you do not know the tool names or parameters.',
      inputSchema: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'Optional mini-app id. When set, returns that app\'s tools only.' },
          includeSchema: {
            type: 'boolean',
            description: 'When appId is set, include full tool definitions with inputSchema (default true). Ignored when listing all apps.',
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: MINIAPP_CALL_TOOL_NAME,
      description:
        'Execute a tool on a session-authorized mini-app. Pass appId + tool name from miniapp_list, and tool arguments as input. Panel open/close is implicit: non-standalone tools lazy-open the panel; standalone tools run without a panel. Do not invent tools — call miniapp_list first when unsure.',
      inputSchema: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'Mini-app id (from miniapp_list or user @-mention).' },
          tool: { type: 'string', description: 'Tool name declared by that app\'s manifest.' },
          input: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments for the app tool. Validated against the tool\'s inputSchema at dispatch time.',
          },
        },
        required: ['appId', 'tool'],
        additionalProperties: false,
      },
    },
  ]
}
