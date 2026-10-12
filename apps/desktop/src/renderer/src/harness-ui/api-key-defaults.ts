import type { HarnessId } from '@superone/shared/agent-types'

export interface ApiKeyDefault {
  brand: string
  labelKey: string
}

/**
 * The built-in account an API-key picker lists before any saved key, for the
 * harnesses that run on third-party keys (`consumerForHarness`).
 */
const API_KEY_DEFAULTS: Partial<Record<HarnessId, ApiKeyDefault>> = {
  claude: { brand: 'claude', labelKey: 'resources.providers.defaultLabelClaude' },
  codex: { brand: 'openai', labelKey: 'resources.providers.defaultLabelCodex' },
}

/** Undefined: the harness has no API-key picker. */
export function apiKeyDefault(harness: HarnessId): ApiKeyDefault | undefined {
  return API_KEY_DEFAULTS[harness]
}

/** The built-in entry, falling back to Claude's for a picker opened on another harness. */
export function apiKeyDefaultFor(harness: HarnessId): ApiKeyDefault {
  return API_KEY_DEFAULTS[harness] ?? API_KEY_DEFAULTS.claude!
}
