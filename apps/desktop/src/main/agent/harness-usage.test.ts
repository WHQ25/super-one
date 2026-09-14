import { describe, expect, it, vi } from 'vitest'
import type { ClaudeRateLimits, CodexRateLimits, ProviderRateLimits } from '@superone/shared/agent-types'
import { codexWindowLabel, readHarnessUsage, type HarnessUsageDeps } from './harness-usage'

const claudeLimits: ClaudeRateLimits = {
  windows: [{ label: '5h', usedPercent: 40, resetsAt: 1_700_000_000 }, { label: 'Weekly', usedPercent: 12, resetsAt: null }],
  extraUsage: { usedDollars: 1.5, limitDollars: 20 },
  planType: 'Max 5x',
  fetchedAt: 1_000,
}

const codexLimits: CodexRateLimits = {
  primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_700_000_000 },
  secondary: { usedPercent: 5, windowDurationMins: 10_080, resetsAt: null },
  planType: 'plus',
  resetCredits: 2,
  resetCreditList: [{ id: 'rc-1', status: 'available', title: 'Reset', description: null, expiresAt: null }],
}

const grokLimits: ProviderRateLimits = {
  title: 'Grok Build',
  windows: [{ label: 'Weekly limit', usedPercent: 70, resetsAt: null }],
  extraUsage: null,
  planType: 'SuperGrok',
  creditBalanceDollars: 12,
}

function deps(overrides: Partial<HarnessUsageDeps> = {}): HarnessUsageDeps {
  return {
    claudeApiProvider: () => 'firstParty',
    claudeRateLimits: vi.fn(async () => claudeLimits),
    claudeAccounts: vi.fn(async () => [
      { credentialDir: null, loggedIn: true, identityKey: 'a|o', email: 'a@x.io', orgId: 'o', orgName: null, subscriptionType: 'max', projectsDirectory: null },
      { credentialDir: '/dir/b', loggedIn: true, identityKey: 'b|o', email: 'b@x.io', orgId: 'o', orgName: null, subscriptionType: 'pro', projectsDirectory: null },
    ]),
    providerRateLimits: vi.fn(async () => ({ ...grokLimits, title: 'GLM' })),
    codexRateLimits: vi.fn(async () => codexLimits),
    codexAccount: vi.fn(async () => ({ signedIn: true, authMode: 'chatgpt' as const, email: 'c@x.io', planType: 'plus', requiresOpenaiAuth: false })),
    codexAccountUsage: vi.fn(async () => ({ lifetimeTokens: 1_000, peakDailyTokens: 200, longestRunningTurnSec: null, currentStreakDays: 3, longestStreakDays: 5 })),
    acpRateLimits: vi.fn(async () => grokLimits),
    ...overrides,
  }
}

describe('readHarnessUsage', () => {
  it('reads the default Claude OAuth meter and names its account', async () => {
    const usage = await readHarnessUsage({ provider: 'claude', projectPath: '/p' }, deps())
    expect(usage).toMatchObject({ kind: 'claude', title: 'Claude', account: 'a@x.io', planType: 'Max 5x' })
    expect(usage?.windows).toHaveLength(2)
  })

  it('keeps a `claude-account:` provider id on the OAuth meter, scoped to that credential dir', async () => {
    const d = deps()
    const usage = await readHarnessUsage({ provider: 'claude', projectPath: '/p', apiProviderId: 'claude-account:/dir/b', force: true }, d)
    expect(d.claudeRateLimits).toHaveBeenCalledWith(true, '/dir/b')
    expect(usage?.account).toBe('b@x.io')
  })

  it('routes any other Claude provider id to the gateway meter', async () => {
    const d = deps()
    const usage = await readHarnessUsage({ provider: 'claude', projectPath: '/p', apiProviderId: 'glm-1' }, d)
    expect(d.providerRateLimits).toHaveBeenCalledWith('glm-1', false)
    expect(d.claudeRateLimits).not.toHaveBeenCalled()
    expect(usage).toMatchObject({ kind: 'provider', title: 'GLM', account: null })
  })

  it('hides the Claude meter when the default login is not a first-party subscription', async () => {
    const d = deps({ claudeApiProvider: () => 'bedrock' })
    expect(await readHarnessUsage({ provider: 'claude', projectPath: '/p' }, d)).toBeNull()
    expect(d.claudeRateLimits).not.toHaveBeenCalled()
  })

  it('flattens Codex primary / secondary into labelled windows and carries credits and stats', async () => {
    const d = deps()
    const usage = await readHarnessUsage({ provider: 'codex', projectPath: '/p', sessionId: 's1' }, d)
    expect(usage).toMatchObject({ kind: 'codex', title: 'Codex', account: 'c@x.io', planType: 'plus', resetCredits: 2 })
    expect(usage?.resetCreditList).toEqual(codexLimits.resetCreditList)
    expect(usage?.codexAccount).toMatchObject({ lifetimeTokens: 1_000, currentStreakDays: 3 })
    expect(d.codexAccountUsage).toHaveBeenCalledWith('/p', null, 's1')
    expect(usage?.windows).toEqual([
      { label: '5h', usedPercent: 30, resetsAt: 1_700_000_000 },
      { label: '7d', usedPercent: 5, resetsAt: null },
    ])
  })

  it('does not name the ChatGPT account for a Codex session billing a third-party key', async () => {
    const d = deps()
    const usage = await readHarnessUsage({ provider: 'codex', projectPath: '/p', apiProviderId: 'openrouter' }, d)
    expect(d.codexAccount).not.toHaveBeenCalled()
    expect(usage?.account).toBeNull()
  })

  it('returns null for Codex when neither window is reported', async () => {
    const d = deps({ codexRateLimits: vi.fn(async () => ({ ...codexLimits, primary: null, secondary: null })) })
    expect(await readHarnessUsage({ provider: 'codex', projectPath: '/p' }, d)).toBeNull()
  })

  it('reads Grok billing through ACP and skips every other ACP agent', async () => {
    const d = deps()
    const grok = await readHarnessUsage({ provider: 'acp', projectPath: '/p', acpAgentId: 'grok', sessionId: 's1' }, d)
    expect(grok).toMatchObject({ kind: 'acp', title: 'Grok Build', creditBalanceDollars: 12 })
    expect(await readHarnessUsage({ provider: 'acp', projectPath: '/p', acpAgentId: 'gemini' }, d)).toBeNull()
    expect(d.acpRateLimits).toHaveBeenCalledTimes(1)
  })

  it('has no meter for harnesses without a subscription surface', async () => {
    expect(await readHarnessUsage({ provider: 'opencode', projectPath: '/p' }, deps())).toBeNull()
  })
})

describe('codexWindowLabel', () => {
  it('names windows by duration like the desktop gauge', () => {
    expect(codexWindowLabel(300)).toBe('5h')
    expect(codexWindowLabel(10_080)).toBe('7d')
    expect(codexWindowLabel(30)).toBe('30m')
    expect(codexWindowLabel(null)).toBe('Usage')
  })
})
