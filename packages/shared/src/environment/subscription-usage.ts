import type { ClaudeRateLimitWindow } from '../agent-types'

/** Subscriptions whose usage a node reads from the login its harness already uses. */
export type SubscriptionHarness = 'claude' | 'codex' | 'grok' | 'opencode' | 'cursor'

/** One signed-in subscription on a node (`environment.usage`). */
export interface SubscriptionUsage {
  harness: SubscriptionHarness
  /** Account label when the node knows one (email, account id); null for the harness's own default login. */
  account: string | null
  planType: string | null
  windows: ClaudeRateLimitWindow[]
  /** Why the windows are missing or stale: an expired login, a failed request. */
  error?: string
}

/** `environment.usage` result. */
export interface EnvironmentUsageReport {
  accounts: SubscriptionUsage[]
}
