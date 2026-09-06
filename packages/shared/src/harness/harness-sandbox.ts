import type { HarnessId } from './harness-id'
import type { CodexPermissionPreset, SandboxInfo, SandboxMode } from '../agent-types'
import { CODEX_PERMISSION_PRESETS } from '../agent-types'

/**
 * Claude: off / on / auto (auto-allow bash).
 * Cursor SDK only has sandbox on/off — no autoAllowBash equivalent.
 * Codex and dsh fold sandbox into permission presets — dsh's preset IS a
 * `sandbox/mode` plus an `approval/policy`, so a second toggle here would be a
 * way to contradict the one the user just picked. ACP / OpenCode have no
 * surface.
 * This gate is about the *toggle*, not visibility — every harness shows a sandbox
 * chip; the ones gated out here get read-only state derived from their permission
 * setting (`deriveSandboxMode`).
 */
export function harnessSupportsSandbox(harnessId: HarnessId): boolean {
  return harnessId === 'claude' || harnessId === 'cursor'
}

/** Sandbox modes offered for a harness (Cursor omits Claude-only `auto`). */
export function harnessSandboxModes(harnessId: HarnessId): SandboxMode[] {
  if (harnessId === 'cursor') return ['off', 'on']
  return ['off', 'on', 'auto']
}

/**
 * Coerce a stored sandbox mode into one the harness can show/apply.
 * Cursor has no `auto` (autoAllowBash) — map it to plain `on`.
 */
export function coerceSandboxModeForHarness(harnessId: HarnessId, mode: SandboxMode): SandboxMode {
  const available = harnessSandboxModes(harnessId)
  if (available.includes(mode)) return mode
  return mode === 'off' ? 'off' : 'on'
}

/**
 * Sandbox UI support level for a harness.
 * Cursor ships its own SDK helpers — Claude's Linux "conditional" probe does not apply.
 */
export function harnessSandboxSupportLevel(
  harnessId: HarnessId,
  capabilitySupport: 'always' | 'conditional' | 'unsupported' = 'always',
): 'always' | 'conditional' | 'unsupported' {
  if (harnessId !== 'cursor') return capabilitySupport
  if (capabilitySupport === 'unsupported') return 'unsupported'
  return 'always'
}

/** The on/off/auto vocabulary the chip claims, read off a runtime's SandboxInfo. */
export function sandboxModeFromInfo(info: SandboxInfo | null | undefined): SandboxMode {
  if (!info?.enabled) return 'off'
  return info.autoAllowBash ? 'auto' : 'on'
}

/**
 * Codex preset a shared `PermissionMode` stands for. Remote Control carries the
 * neutral mode, not Codex's own vocabulary, so the chip has to translate back.
 *
 * Only `bypassPermissions` reaches full access. Every other mode — including ones
 * neither Codex nor dsh offers in its own picker — lands on a preset that still
 * confines the process, which is the safe answer for a chip claiming a sandbox.
 * `read-only` has no PermissionMode spelling, which is why it is absent here.
 */
export function codexPresetForPermissionMode(mode: string | null | undefined): CodexPermissionPreset {
  if (mode === 'bypassPermissions') return 'full-access'
  if (mode === 'auto') return 'auto-review'
  return 'default'
}

/**
 * The one on/off/auto answer the sandbox chip shows, for any harness.
 *
 * - Claude / Cursor drive a real toggle, so their own `SandboxInfo` is the answer.
 * - Codex and dsh fold sandbox into a permission preset; deriving it from that
 *   preset is what keeps the sandbox chip from contradicting the permission chip
 *   beside it. dsh's presets share Codex's `sandboxMode` vocabulary.
 * - ACP (Grok) confines itself from its own env/config at process start. That is
 *   *observed* and handed in as `sandboxInfo`; assuming `off` would claim the
 *   agent is unconfined when it is not.
 * - OpenCode has no sandbox mechanism at all, so `off` is the standing answer.
 */
export function resolveSandboxMode(input: {
  harnessId: HarnessId
  /** Claude/Cursor: the session's own setting. ACP: the sandbox Grok reported. */
  sandboxInfo?: SandboxInfo | null
  /** Codex / dsh carrier mode, when the caller has no native preset id. */
  permissionMode?: string | null
  /** Codex's native preset, when the caller has it (desktop store). */
  codexPreset?: CodexPermissionPreset | null
}): SandboxMode {
  const { harnessId } = input
  if (harnessSupportsSandbox(harnessId)) {
    return coerceSandboxModeForHarness(harnessId, sandboxModeFromInfo(input.sandboxInfo))
  }
  if (harnessId === 'codex' || harnessId === 'dsh') {
    const preset = input.codexPreset ?? codexPresetForPermissionMode(input.permissionMode)
    return CODEX_PERMISSION_PRESETS[preset].sandboxMode === 'danger-full-access' ? 'off' : 'on'
  }
  if (harnessId === 'acp') return sandboxModeFromInfo(input.sandboxInfo)
  return 'off'
}
