import type { HarnessId, RemoteActiveProvider } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness-capabilities'

export function harnessSupportsAdditionalDirs(harness: HarnessId): boolean {
  return HARNESS_CAPABILITIES[harness].supportsAdditionalDirs
}

export function harnessDisplayName(harness: HarnessId): string {
  return HARNESS_CAPABILITIES[harness].displayName
}

export type PoweredByHint = { brandKey: string; name: string }

/**
 * The API provider behind the current harness, as the desktop's
 * `ActiveProviderHint` reports it. Harnesses that carry their own account
 * rather than a SuperOne credential show nothing, matching desktop.
 */
export function poweredByHint(
  harness: HarnessId,
  active?: RemoteActiveProvider | null,
): PoweredByHint | null {
  if (harness !== 'claude' && harness !== 'codex') return null
  const fallback = harness === 'codex'
    ? { brandKey: 'openai', name: 'Codex (Official)' }
    : { brandKey: 'claude', name: 'Claude Code (Official)' }
  if (!active) return fallback
  return { brandKey: active.presetKey || fallback.brandKey, name: active.name || fallback.name }
}
