/**
 * Authoritative args-aware policy for the fixed mini-app MCP tools
 * (`miniapp_list` / `miniapp_call`).
 *
 * Harnesses must not reimplement allow/prompt/deny logic — they call
 * {@link evaluateMiniappFixedToolPermission} (or {@link isToolPreapproved} which
 * delegates here for `miniapp_call`). The miniapp_call executor re-validates
 * session authorization + input schema at dispatch time.
 */

import { MCP_SUPERONE_TOOL_PREFIX } from './superone-host-owned-tools'

export const MINIAPP_LIST_TOOL_NAME = 'miniapp_list' as const
export const MINIAPP_CALL_TOOL_NAME = 'miniapp_call' as const

export const MINIAPP_LIST_QUALIFIED = `${MCP_SUPERONE_TOOL_PREFIX}${MINIAPP_LIST_TOOL_NAME}` as const
export const MINIAPP_CALL_QUALIFIED = `${MCP_SUPERONE_TOOL_PREFIX}${MINIAPP_CALL_TOOL_NAME}` as const

export type MiniappPermissionDecision = 'allow' | 'prompt' | 'deny'

export interface MiniappPermissionEvaluation {
  decision: MiniappPermissionDecision
  /** Present when decision is deny */
  reason?: string
  appId?: string
  tool?: string
}

export interface MiniappPreapproveLookup {
  /**
   * Whether the (appId, tool) pair is in preapproved.json for that install.
   * Implementation lives in superone-mcp-server (holds the Set).
   */
  isAppToolPreapproved(appId: string, toolName: string): boolean
}

let lookup: MiniappPreapproveLookup | null = null

/** Wired once from superone-mcp-server so policy stays free of circular imports. */
export function setMiniappPreapproveLookup(next: MiniappPreapproveLookup | null): void {
  lookup = next
}

export function isMiniappListTool(qualifiedOrBare: string): boolean {
  return qualifiedOrBare === MINIAPP_LIST_TOOL_NAME
    || qualifiedOrBare === MINIAPP_LIST_QUALIFIED
}

export function isMiniappCallTool(qualifiedOrBare: string): boolean {
  return qualifiedOrBare === MINIAPP_CALL_TOOL_NAME
    || qualifiedOrBare === MINIAPP_CALL_QUALIFIED
}

export function parseMiniappCallArgs(input: Record<string, unknown> | undefined | null): {
  appId: string | null
  tool: string | null
  toolInput: Record<string, unknown>
} {
  if (!input || typeof input !== 'object') {
    return { appId: null, tool: null, toolInput: {} }
  }
  const appId = typeof input.appId === 'string' && input.appId.trim() ? input.appId.trim() : null
  const tool = typeof input.tool === 'string' && input.tool.trim() ? input.tool.trim() : null
  const raw = input.input
  const toolInput = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  return { appId, tool, toolInput }
}

/**
 * Single policy entry for harness permission layers and the miniapp_call executor.
 *
 * - `miniapp_list` → always allow (read-only catalog)
 * - `miniapp_call` → allow only when that app's tool is preapproved; else prompt
 *   (deny only when required args are missing / unusable)
 * - legacy `mcp__superone__<appId>__<tool>` → preapprove by appId + tool
 * - anything else → prompt (caller may still short-circuit on host-owned builtins)
 */
export function evaluateMiniappFixedToolPermission(
  qualifiedToolName: string,
  input: Record<string, unknown> = {},
): MiniappPermissionEvaluation {
  if (!qualifiedToolName.startsWith(MCP_SUPERONE_TOOL_PREFIX)) {
    return { decision: 'prompt' }
  }
  const bare = qualifiedToolName.slice(MCP_SUPERONE_TOOL_PREFIX.length)

  if (bare === MINIAPP_LIST_TOOL_NAME) {
    return { decision: 'allow' }
  }

  if (bare === MINIAPP_CALL_TOOL_NAME) {
    const { appId, tool } = parseMiniappCallArgs(input)
    if (!appId || !tool) {
      return {
        decision: 'deny',
        reason: 'miniapp_call requires string fields appId and tool',
        appId: appId ?? undefined,
        tool: tool ?? undefined,
      }
    }
    if (!lookup) {
      return { decision: 'prompt', appId, tool }
    }
    if (lookup.isAppToolPreapproved(appId, tool)) {
      return { decision: 'allow', appId, tool }
    }
    return { decision: 'prompt', appId, tool }
  }

  // Legacy per-app MCP names: mcp__superone__<appId>__<tool>
  if (bare.includes('__')) {
    const idx = bare.indexOf('__')
    const appId = bare.slice(0, idx)
    const tool = bare.slice(idx + 2)
    if (appId && tool && lookup?.isAppToolPreapproved(appId, tool)) {
      return { decision: 'allow', appId, tool }
    }
    return { decision: 'prompt' }
  }

  return { decision: 'prompt' }
}

/**
 * Whether harness layers should auto-allow without a user prompt.
 * Does not cover host-owned builtins — call {@link isBuiltInSuperoneTool} first.
 */
export function shouldAutoAllowMiniappTool(
  qualifiedToolName: string,
  input: Record<string, unknown> = {},
): boolean {
  return evaluateMiniappFixedToolPermission(qualifiedToolName, input).decision === 'allow'
}
