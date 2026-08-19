import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
import { isMainThreadOnlySuperoneTool } from '@superone/shared/superone-host-owned-tools'
import { isBuiltInSuperoneTool, isToolPreapproved } from '../mcp/superone-mcp-server'
import { normalizeAcpTool } from './acp-event-map'

/**
 * Normalize ACP permission tool identity into Claude-style
 * `mcp__server__tool` names so we can reuse SuperOne host preapproval helpers.
 *
 * Grok MCP wire form is `server__tool` (use_tool envelope). SuperOne UI / Claude
 * form is `mcp__server__tool`.
 */
export function toClaudeMcpToolName(raw: string): string | null {
  const name = raw.trim()
  if (!name) return null
  if (name.startsWith('mcp__')) return name
  // Grok / ACP: server__tool (exactly one server segment before first __)
  if (name.includes('__')) return `mcp__${name}`
  return null
}

function collectCandidateClaudeNames(params: RequestPermissionRequest): string[] {
  const out: string[] = []
  const push = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return
    const claude = toClaudeMcpToolName(raw)
    if (claude && !out.includes(claude)) out.push(claude)
  }

  const normalized = normalizeAcpTool(params.toolCall)
  if (normalized?.toolName) push(normalized.toolName)

  const rawInput = params.toolCall.rawInput
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    const r = rawInput as Record<string, unknown>
    push(r.tool_name)
    push(r.toolName)
    push(r.name)
  }

  if (typeof params.toolCall.title === 'string') push(params.toolCall.title)

  const meta = (params.toolCall as { _meta?: Record<string, unknown> | null })._meta
  const xai = meta && typeof meta === 'object' ? meta['x.ai/tool'] : null
  if (xai && typeof xai === 'object' && !Array.isArray(xai)) {
    push((xai as { name?: unknown }).name)
  }

  return out
}

export type AcpPreapproveReason = 'builtin' | 'preapproved'

function collectToolInput(params: RequestPermissionRequest): Record<string, unknown> {
  const rawInput = params.toolCall.rawInput
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) return {}
  const r = rawInput as Record<string, unknown>
  // Grok use_tool envelope nests args under tool_input
  const nested = r.tool_input
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  return r
}

/**
 * Whether SuperOne should auto-allow this ACP permission request without UI.
 * Only host built-ins and user-preapproved mini-app tools — never third-party MCP.
 * miniapp_call preapproval is args-aware (appId + tool from tool_input).
 */
function looksLikeAcpSubagentCall(
  params: RequestPermissionRequest,
  mainSessionId: string | null | undefined,
): boolean {
  if (mainSessionId && params.sessionId && params.sessionId !== mainSessionId) return true
  const meta = (params.toolCall as { _meta?: Record<string, unknown> | null })._meta
  if (meta && typeof meta === 'object') {
    if (typeof meta.subagent_id === 'string' && meta.subagent_id.trim()) return true
    const xai = meta['x.ai/tool']
    if (xai && typeof xai === 'object' && !Array.isArray(xai)) {
      const rec = xai as Record<string, unknown>
      if (typeof rec.subagent_id === 'string' && rec.subagent_id.trim()) return true
      if (typeof rec.agent_id === 'string' && rec.agent_id.trim() && rec.agent_id !== 'main') return true
    }
  }
  return false
}

export type AcpPermissionDecision =
  | { kind: 'deny'; toolName: string; reason: 'main_thread_only' }
  | { kind: 'auto-allow'; toolName: string; reason: AcpPreapproveReason; alwaysAllow: boolean }
  | { kind: 'prompt' }

/**
 * Full ACP permission decision for a tool call.
 * Main-thread-only SuperOne tools (session_rename / session_tag) are denied
 * when the caller is a Grok/ACP child session. They are auto-allowed from the
 * parent session with allow-once so Grok cannot persist a server/tool grant
 * that child sessions would inherit.
 */
export function decideAcpPermission(
  params: RequestPermissionRequest,
  mainSessionId?: string | null,
): AcpPermissionDecision {
  const names = collectCandidateClaudeNames(params)
  const mainThreadTool = names.find((name) => isMainThreadOnlySuperoneTool(name))
  if (mainThreadTool && looksLikeAcpSubagentCall(params, mainSessionId)) {
    return { kind: 'deny', toolName: mainThreadTool, reason: 'main_thread_only' }
  }
  const pre = shouldAutoAllowAcpPermission(params)
  if (!pre.allow) return { kind: 'prompt' }
  return {
    kind: 'auto-allow',
    toolName: pre.toolName,
    reason: pre.reason,
    alwaysAllow: pre.reason === 'builtin' && !isMainThreadOnlySuperoneTool(pre.toolName),
  }
}

export function shouldAutoAllowAcpPermission(
  params: RequestPermissionRequest,
): { allow: true; reason: AcpPreapproveReason; toolName: string } | { allow: false } {
  const input = collectToolInput(params)
  for (const name of collectCandidateClaudeNames(params)) {
    if (isBuiltInSuperoneTool(name)) {
      return { allow: true, reason: 'builtin', toolName: name }
    }
    if (isToolPreapproved(name, input)) {
      return { allow: true, reason: 'preapproved', toolName: name }
    }
  }
  return { allow: false }
}

/**
 * Stamped on initialize + session/new so Grok's `origin_client.product` is
 * `superone`. Mid-session `x.ai/yolo_mode_changed` filters by that product
 * when `clientIdentifier` is present — omitting the stamp made every live
 * permission switch a no-op (auto → always-approve was the visible case).
 */
export const GROK_ACP_CLIENT_IDENTIFIER = 'superone'

/** session/new + session/load `_meta` keys Grok understands for permission + effort. */
export function grokSessionPermissionMeta(
  mode: string | undefined | null,
  opts?: { reasoningEffort?: string | null },
): Record<string, unknown> {
  const meta: Record<string, unknown> = { clientIdentifier: GROK_ACP_CLIENT_IDENTIFIER }
  if (mode === 'bypassPermissions') meta.yoloMode = true
  if (mode === 'auto') meta.autoMode = true
  const effort = opts?.reasoningEffort?.trim()
  if (effort) meta.reasoningEffort = effort
  return meta
}

/** Params for Grok mid-session `x.ai/yolo_mode_changed` notification. */
export function grokYoloModeNotificationParams(
  mode: string | undefined | null,
): Record<string, unknown> {
  const bypass = mode === 'bypassPermissions'
  const auto = mode === 'auto'
  return {
    yolo_mode: bypass,
    auto_mode: auto,
    permission_mode: bypass ? 'always-approve' : auto ? 'auto' : 'ask',
    // Do not send clientIdentifier here. Grok applies the notification only
    // to sessions whose origin_client.product equals that id; a missing
    // origin (older session/new, session/load reconnect) silently drops the
    // update. SuperOne owns a 1:1 stdio process, so every resident session
    // is the right target.
  }
}


