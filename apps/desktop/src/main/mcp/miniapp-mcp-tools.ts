/**
 * Fixed mini-app MCP surface: miniapp_list + miniapp_call + miniapp_open.
 *
 * Precedent: browser-action-mcp-tools.ts (list / do with opaque input record).
 * Per-app tools are not registered on the MCP server. Any app installed for the
 * session's project is available: the first call or open starts its host and
 * registers its tools on the session (registerAppTools), the same grant an
 * @-mention gives. Each app tool is still confirmed in the executor unless preapproved.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import { jsonSchemaToZodShape } from './json-schema-zod'
import type { AgentEvent } from '@superone/shared/agent-types'
import { HOST_ACTION_MINIAPP_DESCRIPTORS } from '@superone/shared/environment/host-action-miniapp-descriptors'
import { focusTabCall, openedTabNote, type OpenedTabPresentation } from '@superone/shared/layout-control'
import {
  MINIAPP_CALL_TOOL_NAME,
  MINIAPP_LIST_TOOL_NAME,
  MINIAPP_OPEN_TOOL_NAME,
  parseMiniappCallArgs,
} from './miniapp-call-policy'
import { awaitMiniappCallConfirm } from './miniapp-call-confirm'

export type MiniappToolReply = {
  content: CallToolResult['content']
  structuredContent?: Record<string, unknown>
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
  /** Apps installed for the session's project, granted or not; empty when it has no local project. */
  listInstalledApps(sessionId: string): Promise<Array<{ appId: string; tools: MiniAppToolDefinition[] }>>
  /** Start an installed app's host and register its tools on the session. False when it is not installed or has no tools. */
  authorizeApp(sessionId: string, appId: string): Promise<boolean>
  /** Open the app's UI in the session's activity panel, in the background. */
  openAppView(sessionId: string, appId: string): Promise<{ status: string; tab: string; name: string; presentation: OpenedTabPresentation }>
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
  /** Compatibility calls return MCP content directly after this executor's approval. */
  dispatchCompatToolCall?(sessionId: string, appId: string, toolName: string, args: Record<string, unknown>): Promise<MiniappToolReply | null>
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
    const apps = deps.getAuthorizedApps(sessionId)
    for (const installed of await deps.listInstalledApps(sessionId)) {
      if (!apps.some((app) => app.appId === installed.appId)) apps.push(installed)
    }
    if (args.appId) {
      const entry = apps.find((a) => a.appId === args.appId)
      if (!entry) {
        return miniappErrorReply(
          new Error(
            `App "${args.appId}" is not installed for this session's project. Call miniapp_list without appId to see installed apps.`,
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
      count: apps.length,
      apps: apps.map((entry) => ({
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

    // Any installed app is callable; the first call starts its host and registers its tools.
    let entry = deps.getAppEntry(sessionId, appId)
    if (!entry && await deps.authorizeApp(sessionId, appId)) entry = deps.getAppEntry(sessionId, appId)
    if (!entry) {
      return miniappErrorReply(
        new Error(`App "${appId}" is not installed for this session's project. Call miniapp_list to see installed apps.`),
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

    const compat = await deps.dispatchCompatToolCall?.(sessionId, appId, tool, parsed.data as Record<string, unknown>)
    if (compat) return compat
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

/** Open an app's UI; tools stay callable whether or not it is shown. */
export async function executeMiniappOpen(
  sessionId: string,
  args: { appId: string },
  deps: MiniappToolDeps,
): Promise<MiniappToolReply> {
  try {
    const appId = args.appId.trim()
    if (!appId) return miniappErrorReply(new Error('miniapp_open requires appId'))
    const opened = await deps.openAppView(sessionId, appId)
    return miniappTextReply({
      status: opened.status,
      appId,
      name: opened.name,
      tab: opened.tab,
      ...openedTabNote(opened.presentation, focusTabCall(opened.tab)),
    })
  } catch (err) {
    return miniappErrorReply(err)
  }
}

function descriptor(name: string) {
  const found = HOST_ACTION_MINIAPP_DESCRIPTORS.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Missing mini-app tool descriptor: ${name}`)
  return found
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function recordArg(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Run a fixed mini-app tool by bare name; null for any other name. Shared by the in-process and HTTP surfaces. */
export function executeMiniappFixedTool(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  deps: MiniappToolDeps,
): Promise<MiniappToolReply> | null {
  switch (toolName) {
    case MINIAPP_LIST_TOOL_NAME:
      return executeMiniappList(sessionId, {
        appId: typeof args.appId === 'string' ? args.appId : undefined,
        includeSchema: typeof args.includeSchema === 'boolean' ? args.includeSchema : undefined,
      }, deps)
    case MINIAPP_CALL_TOOL_NAME:
      return executeMiniappCall(sessionId, { appId: stringArg(args.appId), tool: stringArg(args.tool), input: recordArg(args.input) }, deps)
    case MINIAPP_OPEN_TOOL_NAME:
      return executeMiniappOpen(sessionId, { appId: stringArg(args.appId) }, deps)
    default:
      return null
  }
}

export function registerMiniappTools(
  server: McpServer,
  sessionId: string,
  deps: MiniappToolDeps,
): void {
  for (const name of [MINIAPP_LIST_TOOL_NAME, MINIAPP_CALL_TOOL_NAME, MINIAPP_OPEN_TOOL_NAME]) {
    const { description, inputSchema } = descriptor(name)
    server.registerTool(
      name,
      { description, inputSchema: jsonSchemaToZodShape(inputSchema) },
      async (raw) => executeMiniappFixedTool(sessionId, name, raw as Record<string, unknown>, deps)!,
    )
  }
}

export function getMiniappFixedToolDescriptors(): Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}> {
  return HOST_ACTION_MINIAPP_DESCRIPTORS
}
