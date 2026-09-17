import type { CodexPermissionPreset, CodexReasoningEffort, PermissionMode, SandboxInfo, SendMessageRequest } from '@superone/shared/agent-types'
import type { BackendStartOptions } from '../types'
import type { CodexSession } from '../../codex/codex-session'

export interface CodexBackendSelectionPatch {
  model?: string | null
  reasoningEffort?: CodexReasoningEffort | null
  serviceTier?: string | null
}

/** Keep picker defaults and the live runtime in sync, including explicit resets. */
export function applyCodexBackendSelection(
  opts: BackendStartOptions | null,
  session: CodexSession | null,
  selection: CodexBackendSelectionPatch,
): void {
  if (selection.model !== undefined) {
    const model = selection.model?.trim() || undefined
    if (opts) opts.model = model
    if (session) session.model = model
  }
  if (selection.reasoningEffort !== undefined) {
    // The shared effort type omits Codex-only minimal/ultra; keep the exact
    // provider value, as the session settings broadcast does.
    if (opts) opts.effort = (selection.reasoningEffort ?? undefined) as BackendStartOptions['effort']
    if (session) session.modelReasoningEffort = selection.reasoningEffort ?? undefined
  }
  if (selection.serviceTier !== undefined) {
    if (opts) opts.serviceTier = selection.serviceTier
    if (session) session.serviceTier = selection.serviceTier
  }
}

export interface CodexBackendConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  extraEnv?: Record<string, string>
  permissionPreset?: CodexPermissionPreset
  reasoningEffort?: CodexReasoningEffort
}

export function mapCodexPermissionMode(mode: PermissionMode | undefined, sandbox?: SandboxInfo): CodexPermissionPreset {
  if (mode === 'auto') return 'auto-review'
  if (mode === 'bypassPermissions' || mode === 'acceptEdits') return 'full-access'
  // dontAsk alone does not authorize disabling an enabled sandbox.
  if (mode === 'dontAsk' && sandbox?.enabled === false) return 'full-access'
  return 'default'
}

/** Prewarm and sends must agree on the approved session's effective settings. */
export function resolveCodexBackendSelection(opts: BackendStartOptions, request?: SendMessageRequest): {
  model?: string
  reasoningEffort?: CodexReasoningEffort
  permissionPreset: CodexPermissionPreset
} {
  const config = (opts.config && typeof opts.config === 'object' ? opts.config : {}) as CodexBackendConfig
  const approvedFullAccess = opts.permissionMode === 'dontAsk' && opts.sandboxInfo?.enabled === false
  return {
    model: request?.model ?? opts.model ?? config.model,
    reasoningEffort: request?.codex?.reasoningEffort ?? request?.effort ?? opts.effort ?? config.reasoningEffort,
    permissionPreset: request?.codex?.permissionPreset
      ?? (approvedFullAccess ? 'full-access' : config.permissionPreset)
      ?? mapCodexPermissionMode(opts.permissionMode, opts.sandboxInfo),
  }
}
