import type { HarnessId } from '@superone/shared/agent-types'

export interface ApiKeyDefault {
  brand: string
  labelKey: string
}

/**
 * The built-in account an API-key picker lists before any saved key, for the
 * harnesses that run on third-party keys (`consumerForHarness`).
 */
export const API_KEY_DEFAULTS = {
  claude: { brand: 'claude', labelKey: 'resources.providers.defaultLabelClaude' },
  codex: { brand: 'openai', labelKey: 'resources.providers.defaultLabelCodex' },
} as const satisfies Partial<Record<HarnessId, ApiKeyDefault>>

export function apiKeyDefaultFor(harness: HarnessId): ApiKeyDefault {
  return (API_KEY_DEFAULTS as Partial<Record<HarnessId, ApiKeyDefault>>)[harness] ?? API_KEY_DEFAULTS.claude
}
