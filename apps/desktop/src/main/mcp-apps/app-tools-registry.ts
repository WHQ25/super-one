import { sessionKey as toSessionKey, type SessionRef } from '@superone/shared/environment/refs'
import { McpAppsError, type McpAppRequester, type McpAppToolPrompt, type McpAppToolResult } from '@superone/shared/mcp-apps'
import {
  boundMcpAppToolCallResult,
  validateMcpAppRegisteredTools,
  type McpAppRegisteredTool,
  type McpAppViewToolCatalog,
} from '@superone/shared/mcp-app-tools'
import { mcpAppRequesterKey } from './executor-core'

export const MCP_APP_TOOL_EXECUTION_TIMEOUT_MS = 45_000

export interface McpAppToolApprovalOutcome {
  approved: boolean
  alwaysAllow?: boolean
  cancelled?: boolean
}

export interface McpAppViewToolSurfaceDispatch {
  requestApproval(prompt: McpAppToolPrompt, signal: AbortSignal): Promise<McpAppToolApprovalOutcome>
  callTool(toolName: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpAppToolResult>
}

export interface RegisterMcpAppViewToolsInput {
  sessionKey: string
  projectScope: string
  requester: McpAppRequester
  ownerId?: number
  catalog: Omit<McpAppViewToolCatalog, 'tools'> & { tools: unknown }
  dispatch: McpAppViewToolSurfaceDispatch
}

interface RegisteredSurfaceEntry {
  key: string
  sessionKey: string
  projectScope: string
  requesterKey: string
  ownerId?: number
  updatedAt: number
  catalog: McpAppViewToolCatalog
  dispatch: McpAppViewToolSurfaceDispatch
  lifetime: AbortController
}

function entryKey(sessionKey: string, requesterKey: string, viewId: string): string {
  return JSON.stringify([sessionKey, requesterKey, viewId])
}

function standingRuleKey(
  projectScope: string,
  server: string,
  originToolName: string | undefined,
  toolName: string,
  definitionHash: string,
): string {
  return JSON.stringify([projectScope, server, originToolName ?? '', toolName, definitionHash])
}

export interface McpAppToolsRegistryOptions {
  resolvePreferredRequester?: (sessionKey: string) => string | undefined
  executionTimeoutMs?: number
  now?: () => number
}

export class McpAppToolsRegistry {
  private readonly entries = new Map<string, RegisteredSurfaceEntry>()
  private readonly standingRules = new Set<string>()
  private resolvePreferredRequester?: (sessionKey: string) => string | undefined
  private readonly executionTimeoutMs: number
  private readonly now: () => number

  constructor(options: McpAppToolsRegistryOptions = {}) {
    this.resolvePreferredRequester = options.resolvePreferredRequester
    this.executionTimeoutMs = options.executionTimeoutMs ?? MCP_APP_TOOL_EXECUTION_TIMEOUT_MS
    this.now = options.now ?? Date.now
  }

  setPreferredRequesterResolver(resolver: ((sessionKey: string) => string | undefined) | undefined): void {
    this.resolvePreferredRequester = resolver
  }

  syncView(input: RegisterMcpAppViewToolsInput): McpAppRegisteredTool[] {
    const reqKey = mcpAppRequesterKey(input.requester)
    const key = entryKey(input.sessionKey, reqKey, input.catalog.viewId)
    const tools = validateMcpAppRegisteredTools(input.catalog.tools)
    const previous = this.entries.get(key)
    if (tools.length === 0) {
      if (previous && (input.ownerId === undefined || previous.ownerId === input.ownerId)) {
        this.removeEntry(key, previous)
      }
      return []
    }
    const lifetime = previous && (input.ownerId === undefined || previous.ownerId === input.ownerId)
      ? previous.lifetime
      : new AbortController()
    if (previous && previous.lifetime !== lifetime) {
      previous.lifetime.abort()
    }
    this.entries.set(key, {
      key,
      sessionKey: input.sessionKey,
      projectScope: input.projectScope,
      requesterKey: reqKey,
      ownerId: input.ownerId,
      updatedAt: this.now(),
      catalog: {
        viewId: input.catalog.viewId,
        server: input.catalog.server,
        ...(input.catalog.serverTitle ? { serverTitle: input.catalog.serverTitle } : {}),
        ...(input.catalog.originToolName ? { originToolName: input.catalog.originToolName } : {}),
        ...(input.catalog.viewTitle ? { viewTitle: input.catalog.viewTitle } : {}),
        tools,
      },
      dispatch: input.dispatch,
      lifetime,
    })
    return tools
  }

  unregisterView(sessionKey: string, requester: McpAppRequester, viewId: string, ownerId?: number): void {
    const key = entryKey(sessionKey, mcpAppRequesterKey(requester), viewId)
    const entry = this.entries.get(key)
    if (!entry) return
    if (ownerId !== undefined && entry.ownerId !== ownerId) return
    this.removeEntry(key, entry)
  }

  releaseSession(refOrKey: SessionRef | string): void {
    const targetSessionKey = typeof refOrKey === 'string' ? refOrKey : toSessionKey(refOrKey)
    for (const [key, entry] of [...this.entries]) {
      if (entry.sessionKey === targetSessionKey) this.removeEntry(key, entry)
    }
  }

  releaseRequester(requester: McpAppRequester | string): void {
    const reqKey = typeof requester === 'string' ? requester : mcpAppRequesterKey(requester)
    for (const [key, entry] of [...this.entries]) {
      if (entry.requesterKey === reqKey) this.removeEntry(key, entry)
    }
  }

  releaseWindowOwner(ownerId: number): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.ownerId === ownerId) this.removeEntry(key, entry)
    }
  }

  clearForTests(): void {
    for (const [key, entry] of [...this.entries]) this.removeEntry(key, entry)
    this.standingRules.clear()
  }

  listSessionViews(sessionKey: string): McpAppViewToolCatalog[] {
    const byView = new Map<string, RegisteredSurfaceEntry[]>()
    for (const entry of this.entries.values()) {
      if (entry.sessionKey !== sessionKey || entry.catalog.tools.length === 0) continue
      const list = byView.get(entry.catalog.viewId)
      if (list) list.push(entry)
      else byView.set(entry.catalog.viewId, [entry])
    }
    const preferred = this.resolvePreferredRequester?.(sessionKey)
    const result: McpAppViewToolCatalog[] = []
    for (const candidates of byView.values()) {
      result.push(this.pickSurface(candidates, preferred).catalog)
    }
    return result
  }

  getView(sessionKey: string, viewId: string): McpAppViewToolCatalog | null {
    const entry = this.selectSurface(sessionKey, viewId)
    return entry ? entry.catalog : null
  }

  isToolStandingApproved(
    projectScope: string,
    server: string,
    originToolName: string | undefined,
    tool: McpAppRegisteredTool,
  ): boolean {
    if (tool.schemaFallback) return false
    return this.standingRules.has(standingRuleKey(projectScope, server, originToolName, tool.name, tool.definitionHash))
  }

  markToolStandingApproved(
    projectScope: string,
    server: string,
    originToolName: string | undefined,
    tool: McpAppRegisteredTool,
  ): void {
    if (tool.schemaFallback) return
    this.standingRules.add(standingRuleKey(projectScope, server, originToolName, tool.name, tool.definitionHash))
  }

  async invokeTool(input: {
    sessionKey: string
    viewId: string
    toolName: string
    args: Record<string, unknown>
    argsPreview: string
    bypassApproval?: boolean
    signal?: AbortSignal
  }): Promise<
    | { status: 'executed'; result: McpAppToolResult; tool: McpAppRegisteredTool }
    | { status: 'denied' | 'cancelled'; tool: McpAppRegisteredTool }
  > {
    const entry = this.requireSurface(input.sessionKey, input.viewId)
    const tool = entry.catalog.tools.find((candidate) => candidate.name === input.toolName)
    if (!tool) {
      const available = entry.catalog.tools.map((candidate) => candidate.name).join(', ') || '(none)'
      throw new McpAppsError(
        'invalid',
        `Unknown tool "${input.toolName}" on MCP App View "${input.viewId}". Available tools: ${available}. Call mcp_app_tools_list({ viewId: "${input.viewId}" }) for definitions.`,
      )
    }

    const callerSignal = input.signal ?? new AbortController().signal
    const approvalSignal = AbortSignal.any([callerSignal, entry.lifetime.signal])
    if (approvalSignal.aborted) {
      throw new McpAppsError('cancelled', 'MCP App tool call cancelled')
    }

    const preapproved = input.bypassApproval === true
      || this.isToolStandingApproved(entry.projectScope, entry.catalog.server, entry.catalog.originToolName, tool)

    if (!preapproved) {
      const prompt: McpAppToolPrompt = {
        kind: 'callAppTool',
        server: entry.catalog.serverTitle || entry.catalog.server,
        viewId: entry.catalog.viewId,
        ...(entry.catalog.viewTitle ? { viewTitle: entry.catalog.viewTitle } : {}),
        toolName: tool.name,
        ...(tool.title ? { toolTitle: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        argsPreview: input.argsPreview,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        ...(tool.schemaFallback ? { schemaFallback: true } : {}),
        allowAlwaysAllow: !tool.schemaFallback,
      }
      const approval = await entry.dispatch.requestApproval(prompt, approvalSignal)
      if (!approval.approved) {
        return { status: approval.cancelled ? 'cancelled' : 'denied', tool }
      }
      if (approval.alwaysAllow && !tool.schemaFallback) {
        this.markToolStandingApproved(entry.projectScope, entry.catalog.server, entry.catalog.originToolName, tool)
      }
    }

    const activeEntry = this.entries.get(entry.key)
    if (!activeEntry || activeEntry.lifetime.signal.aborted) {
      throw new McpAppsError('cancelled', `MCP App View "${input.viewId}" closed before tool execution started`)
    }
    const currentTool = activeEntry.catalog.tools.find((candidate) => candidate.name === input.toolName)
    if (!currentTool || currentTool.definitionHash !== tool.definitionHash) {
      throw new McpAppsError('denied', `MCP App tool "${input.toolName}" changed definition before execution; re-list with mcp_app_tools_list`)
    }

    const timeoutSignal = AbortSignal.timeout(this.executionTimeoutMs)
    const execSignal = AbortSignal.any([callerSignal, activeEntry.lifetime.signal, timeoutSignal])
    try {
      const raw = await activeEntry.dispatch.callTool(input.toolName, input.args, execSignal)
      return { status: 'executed', result: boundMcpAppToolCallResult(raw), tool: currentTool }
    } catch (error) {
      if (timeoutSignal.aborted && !callerSignal.aborted && !activeEntry.lifetime.signal.aborted) {
        throw new McpAppsError('timeout', `MCP App tool "${input.toolName}" timed out after ${Math.round(this.executionTimeoutMs / 1000)}s`)
      }
      if (activeEntry.lifetime.signal.aborted && !callerSignal.aborted) {
        throw new McpAppsError('cancelled', `MCP App View "${input.viewId}" closed during tool execution`)
      }
      throw error
    }
  }

  private removeEntry(key: string, entry: RegisteredSurfaceEntry): void {
    this.entries.delete(key)
    entry.lifetime.abort()
  }

  private selectSurface(sessionKey: string, viewId: string): RegisteredSurfaceEntry | null {
    const candidates: RegisteredSurfaceEntry[] = []
    for (const entry of this.entries.values()) {
      if (entry.sessionKey === sessionKey && entry.catalog.viewId === viewId && entry.catalog.tools.length > 0) {
        candidates.push(entry)
      }
    }
    if (candidates.length === 0) return null
    return this.pickSurface(candidates, this.resolvePreferredRequester?.(sessionKey))
  }

  private requireSurface(sessionKey: string, viewId: string): RegisteredSurfaceEntry {
    const selected = this.selectSurface(sessionKey, viewId)
    if (!selected) {
      throw new McpAppsError(
        'not_connected',
        `MCP App View "${viewId}" is not currently mounted in this session. Call mcp_app_tools_list to see open Views.`,
      )
    }
    return selected
  }

  private pickSurface(candidates: RegisteredSurfaceEntry[], preferredRequester?: string): RegisteredSurfaceEntry {
    if (candidates.length === 1) return candidates[0]
    if (preferredRequester) {
      const preferred = candidates.find((candidate) => candidate.requesterKey === preferredRequester)
      if (preferred) return preferred
    }
    const desktop = candidates.find((candidate) => candidate.requesterKey === 'desktop')
    if (desktop) return desktop
    return candidates.reduce((latest, candidate) => (candidate.updatedAt >= latest.updatedAt ? candidate : latest))
  }
}

let defaultRegistry: McpAppToolsRegistry | undefined

export function getMcpAppToolsRegistry(): McpAppToolsRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new McpAppToolsRegistry()
  }
  return defaultRegistry
}
