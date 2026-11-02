import { describe, expect, it } from 'vitest'
import type { EnvironmentUsageReport } from '@superone/shared/environment'
import { claudeLimitsFromSubscription, claudeSubscriptionFromReport } from './remote-subscription-usage'

const report: EnvironmentUsageReport = {
  accounts: [
    { harness: 'codex', account: 'local-looking@openai.test', planType: 'plus', windows: [] },
    {
      harness: 'claude',
      account: null,
      apiProviderId: null,
      planType: 'max',
      windows: [{ label: '5h', usedPercent: 40, resetsAt: 1 }],
    },
    {
      harness: 'claude',
      account: 'named@anthropic.test',
      apiProviderId: 'claude-account:work',
      planType: 'team',
      windows: [{ label: '5h', usedPercent: 10, resetsAt: 2 }],
    },
  ],
}

describe('claudeSubscriptionFromReport', () => {
  it('uses the node default login when the session has no matching account id', () => {
    expect(claudeSubscriptionFromReport(report, null)?.planType).toBe('max')
    expect(claudeSubscriptionFromReport(report, 'claude-account:this-desktop')?.planType).toBe('max')
  })

  it('uses the named node account when the report has that id', () => {
    const row = claudeSubscriptionFromReport(report, 'claude-account:work')
    expect(row?.account).toBe('named@anthropic.test')
    expect(claudeLimitsFromSubscription(row!).windows).toEqual([{ label: '5h', usedPercent: 10, resetsAt: 2 }])
  })

  it('returns null when the node reported no Claude login', () => {
    expect(claudeSubscriptionFromReport({ accounts: [] }, null)).toBeNull()
  })
})
