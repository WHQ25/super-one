import type { AppSettings, CodexPermissionPreset, HarnessId, PermissionMode, SandboxMode } from '../agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '../launch-options'

/**
 * Shared permission mode a Codex preset stands for.
 *
 * Codex stores its own vocabulary because that is what its backend executes
 * (`codex-session` takes a preset, never a mode); the shared mode is a
 * projection for surfaces that speak the common language — the remote catalog
 * and the mobile picker. `read-only` has no mode spelling, hence the null.
 */
export function codexPermissionModeForPreset(
  preset: CodexPermissionPreset | '' | null | undefined,
): PermissionMode | '' {
  if (preset === 'auto-review') return 'auto'
  if (preset === 'full-access') return 'bypassPermissions'
  if (preset === 'default') return 'default'
  return ''
}

export interface HarnessSessionDefaults {
  /**
   * Never empty — falls back to the first mode the harness declares, which is
   * what it would start in anyway.
   */
  permissionMode: PermissionMode
  /** What the user configured, or `''` when they have not. */
  configuredPermissionMode: PermissionMode | ''
  /**
   * `null` when this harness owns no sandbox toggle. Distinct from `'off'`,
   * which is a real choice — callers that conflate them end up claiming an
   * unconfined session on a harness that simply has no switch.
   *
   * Not coerced for the host platform: that needs a capability probe this
   * module deliberately does not reach for. Callers that can sandbox apply it.
   */
  sandboxMode: SandboxMode | null
}

/**
 * The one place that answers "what does a new session on this harness start
 * with". Every harness owns its own values, because the permission vocabularies
 * genuinely differ — Cursor says `agent`, Codex has no `acceptEdits`, and a
 * single shared setting could only ever be right for the harness it was
 * written for.
 *
 * This is the named dispatch point for that difference. Callers consume the
 * result; they must not re-derive it by reaching into `agentPreference` for a
 * particular harness.
 */
export function sessionDefaultsForHarness(
  preferences: AppSettings['agentPreference'],
  harnessId: HarnessId,
): HarnessSessionDefaults {
  const configuredPermissionMode = configuredPermissionModeFor(preferences, harnessId)
  const offered = HARNESS_LAUNCH_OPTIONS[harnessId].permissionModes
  return {
    // A stored mode this harness no longer offers is not asserted at it.
    permissionMode: configuredPermissionMode && offered.includes(configuredPermissionMode)
      ? configuredPermissionMode
      : offered[0]!,
    configuredPermissionMode,
    sandboxMode: sandboxDefaultForHarness(preferences, harnessId),
  }
}

function configuredPermissionModeFor(
  preferences: AppSettings['agentPreference'],
  harnessId: HarnessId,
): PermissionMode | '' {
  // Codex stores a preset because that is what its backend executes; the shared
  // mode is a projection of it, not a second stored value.
  if (harnessId === 'codex') {
    return codexPermissionModeForPreset(preferences.codex?.defaultPermissionPreset)
  }
  // A slot can be absent when the caller holds a partially built preference
  // object — a settings file written by an older build, or a test fixture that
  // only fills the harness it exercises. Absent reads as "not configured",
  // which is the same answer and lands on the harness's own first mode.
  const slot = preferences[harnessId] as { defaultPermissionMode?: PermissionMode | '' } | undefined
  return slot?.defaultPermissionMode ?? ''
}

function sandboxDefaultForHarness(
  preferences: AppSettings['agentPreference'],
  harnessId: HarnessId,
): SandboxMode | null {
  // Only the harnesses with a real toggle store one; the rest derive their
  // sandbox from the permission setting and have nothing to configure.
  const stored = harnessId === 'claude'
    ? preferences.claude?.defaultSandboxMode
    : harnessId === 'cursor'
      ? preferences.cursor?.defaultSandboxMode
      : ''
  return stored || null
}
