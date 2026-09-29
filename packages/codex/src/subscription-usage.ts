import { createHash } from 'node:crypto'
import type { CodexRateLimits } from '@superone/shared/agent-types'
import { SubscriptionUsageTracker } from '@superone/shared/subscription-usage'

const history = new SubscriptionUsageTracker()

export function trackCodexSubscription(limits: CodexRateLimits, account: Record<string, unknown> | null, scope: string): CodexRateLimits {
  const fetchedAt = Date.now()
  // Older servers can supply limits without an identifiable account. Keep those raw meters usable.
  if (!account || typeof account.email !== 'string') return { ...limits, fetchedAt }
  const quotaKey = `codex:${createHash('sha256').update(JSON.stringify([
    scope, account.id ?? account.accountId ?? '', account.email, account.planType ?? limits.planType,
  ])).digest('hex')}`
  const track = (window: CodexRateLimits['primary'], slot: string): CodexRateLimits['primary'] => {
    if (!window) return null
    const id = `${slot}:${window.windowDurationMins ?? 'unknown'}`
    const observed = history.observe(quotaKey, { ...window, id, label: id }, fetchedAt)
    return { ...window, id, usedPercent: observed.usedPercent, resetsAt: observed.resetsAt, forecast: observed.forecast }
  }
  return { ...limits, quotaKey, fetchedAt, primary: track(limits.primary, 'primary'), secondary: track(limits.secondary, 'secondary') }
}
