import type { ClaudeRateLimitWindow } from '../agent-types'

/** Subscriptions whose usage a node reads from the login its harness already uses. */
export type SubscriptionHarness = 'claude' | 'codex' | 'grok' | 'opencode' | 'cursor'

/** One signed-in subscription on a node (`environment.usage`). */
export interface SubscriptionUsage {
  harness: SubscriptionHarness
  /**
   * Account email or id when the node knows one.
   * Null when that login has no stored identity. Grok's default login still
   * carries the email from its CLI auth file.
   */
  account: string | null
  /**
   * The launch `apiProviderId` that runs on this subscription
   * (`claude-account:…` / `codex-account:…`); null when the node only has the
   * harness's default login, which a launch reaches by omitting the field.
   */
  apiProviderId?: string | null
  planType: string | null
  windows: ClaudeRateLimitWindow[]
  /**
   * This login is the one a launch uses when it omits `apiProviderId`.
   * A Codex session does that for the node's default account, whose row still
   * carries `codex-account:…`.
   */
  isDefault?: boolean
  /** Why the windows are missing or stale: an expired login, a failed request. */
  error?: string
}

/** `environment.usage` result. */
export interface EnvironmentUsageReport {
  accounts: SubscriptionUsage[]
}
