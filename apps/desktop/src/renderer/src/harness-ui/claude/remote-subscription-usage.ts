import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import type { EnvironmentUsageReport, SubscriptionUsage } from '@superone/shared/environment'

/**
 * Claude row from a node's `environment.usage` report.
 * A named account wins when the node listed it. Otherwise the harness default
 * login (no `apiProviderId`) is the quota a remote Claude session spends.
 * This never substitutes another machine's reading.
 */
export function claudeSubscriptionFromReport(
  report: EnvironmentUsageReport,
  apiProviderId?: string | null,
): SubscriptionUsage | null {
  const accounts = report.accounts.filter((row) => row.harness === 'claude')
  if (apiProviderId) {
    const named = accounts.find((row) => row.apiProviderId === apiProviderId)
    if (named) return named
  }
  return accounts.find((row) => !row.apiProviderId) ?? accounts[0] ?? null
}

export function claudeLimitsFromSubscription(row: SubscriptionUsage): ClaudeRateLimits {
  return {
    quotaKey: `node:${row.apiProviderId ?? row.account ?? 'default'}`,
    planType: row.planType,
    windows: row.windows,
    extraUsage: null,
    error: row.error,
    fetchedAt: Date.now(),
  }
}

/** A rejected or empty node read. The gauge stays on the node and shows unavailable. */
export function unavailableNodeLimits(connectionId: string): ClaudeRateLimits {
  return {
    quotaKey: `node:${connectionId}`,
    planType: null,
    windows: [],
    extraUsage: null,
    error: 'unavailable',
    fetchedAt: Date.now(),
  }
}
