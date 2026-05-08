import type { ApiProvider, HarnessId } from '@superone/shared/agent-types'

/**
 * Resolve which ApiProvider is actually driving requests for a session.
 *
 * Mirrors `resolveApiProviderForSession` in main/index.ts:
 * - Per-session override wins if the provider still exists and supports the harness.
 * - Otherwise fall back to the global default (`is_active_claude` / `is_active_codex`).
 */
export function selectEffectiveApiProvider(
  providers: ApiProvider[],
  harness: HarnessId,
  sessionApiProviderId: string | null,
): ApiProvider | null {
  if (sessionApiProviderId) {
    const explicit = providers.find((p) => p.id === sessionApiProviderId)
    if (explicit && supportsHarness(explicit, harness)) return explicit
  }
  const activeCol = harness === 'codex' ? 'is_active_codex' : 'is_active_claude'
  return providers.find((p) => p[activeCol] === 1) ?? null
}

function supportsHarness(provider: ApiProvider, harness: HarnessId): boolean {
  try {
    const supported = JSON.parse(provider.supported_agents || '["claude"]') as string[]
    return Array.isArray(supported) && supported.includes(harness)
  } catch {
    return harness === 'claude'
  }
}
