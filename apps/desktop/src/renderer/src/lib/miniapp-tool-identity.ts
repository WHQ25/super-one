/**
 * Resolve mini-app tool identity from MCP tool name + args.
 *
 * Supports:
 * - Fixed tools: miniapp_call with { appId, tool, input }
 * - Legacy transcript names: mcp bare name `toolSlug__toolName` (render-only back-compat)
 */

import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'

export interface MiniAppLike {
  id: string
  manifest: {
    name: string
    toolSlug?: string
    tools?: MiniAppToolDefinition[]
    templates?: Record<string, string>
  }
}

export interface ResolvedMiniAppTool {
  app: MiniAppLike
  appId: string
  toolSlug: string
  toolName: string
  toolDef: MiniAppToolDefinition | undefined
  /** Args that the app tool itself receives (inner input for miniapp_call). */
  toolInput: Record<string, unknown>
  /** True when resolved from historical slug__tool MCP names. */
  legacy: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/**
 * @param mcpToolName Bare SuperOne tool name after stripping `mcp__superone__`
 *   (e.g. `miniapp_call` or `excalidraw__clear_canvas`).
 * @param params Parsed tool_use input / Codex arguments.
 */
export function resolveMiniAppToolIdentity(
  mcpToolName: string,
  params: Record<string, unknown>,
  apps: readonly MiniAppLike[],
): ResolvedMiniAppTool | null {
  if (mcpToolName === 'miniapp_call') {
    const appId = typeof params.appId === 'string' ? params.appId : ''
    const toolName = typeof params.tool === 'string' ? params.tool : ''
    if (!appId || !toolName) return null
    const app = apps.find((a) => a.id === appId)
      ?? apps.find((a) => (a.manifest.toolSlug ?? a.id) === appId)
    if (!app) {
      // Still return a synthetic resolution so UI can show appId/tool text.
      return {
        app: { id: appId, manifest: { name: appId } },
        appId,
        toolSlug: appId,
        toolName,
        toolDef: undefined,
        toolInput: asRecord(params.input),
        legacy: false,
      }
    }
    const toolSlug = app.manifest.toolSlug ?? app.id
    const toolDef = app.manifest.tools?.find((t) => t.name === toolName)
    return {
      app,
      appId: app.id,
      toolSlug,
      toolName,
      toolDef,
      toolInput: asRecord(params.input),
      legacy: false,
    }
  }

  // Legacy: slug__toolName (historical transcripts only — no execution path).
  const appToolMatch = mcpToolName.match(/^(.+?)__(.+)$/)
  if (!appToolMatch) return null
  const [, mcpSlug, mcpToolNamePart] = appToolMatch
  const app = apps.find((a) => (a.manifest.toolSlug ?? a.id) === mcpSlug)
  if (!app) {
    return {
      app: { id: mcpSlug, manifest: { name: mcpSlug } },
      appId: mcpSlug,
      toolSlug: mcpSlug,
      toolName: mcpToolNamePart,
      toolDef: undefined,
      toolInput: params,
      legacy: true,
    }
  }
  const toolDef = app.manifest.tools?.find((t) => t.name === mcpToolNamePart)
  return {
    app,
    appId: app.id,
    toolSlug: app.manifest.toolSlug ?? app.id,
    toolName: mcpToolNamePart,
    toolDef,
    toolInput: params,
    legacy: true,
  }
}

/** Whether a Claude-style full tool name is a mini-app tool call (fixed or legacy). */
export function isMiniAppMcpToolName(fullToolName: string): boolean {
  if (!fullToolName.startsWith('mcp__superone__')) return false
  const bare = fullToolName.slice('mcp__superone__'.length)
  if (bare === 'miniapp_call') return true
  return bare.includes('__')
}
