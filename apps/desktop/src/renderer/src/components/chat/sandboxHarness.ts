import type { HarnessId, SandboxMode } from '@superone/shared/agent-types'

/**
 * Claude: off / on / auto (auto-allow bash).
 * Cursor SDK only has sandbox on/off — no autoAllowBash equivalent.
 * Codex and dsh fold sandbox into permission presets — dsh's preset IS a
 * `sandbox/mode` plus an `approval/policy`, so a second toggle here would be a
 * way to contradict the one the user just picked. ACP / OpenCode have no
 * surface.
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
