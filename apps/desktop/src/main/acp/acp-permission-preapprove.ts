import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'
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

/** session/new `_meta` keys Grok understands for permission baseline. */
export function grokSessionPermissionMeta(
  mode: string | undefined | null,
): Record<string, unknown> {
  if (mode === 'bypassPermissions') return { yoloMode: true }
  if (mode === 'auto') return { autoMode: true }
  return {}
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
    clientIdentifier: 'superone',
  }
}


