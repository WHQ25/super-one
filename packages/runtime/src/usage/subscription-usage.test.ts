import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const reading = (planType: string) => ({ value: { planType, windows: [{ label: '5h', usedPercent: 10, resetsAt: null }], extraUsage: null } })
  return {
    reading,
    claude: vi.fn(async (_dir: string | null) => reading('Max')),
    codex: vi.fn(async (_opts: { home?: string }) => reading('Pro')),
  }
})

vi.mock('./claude', () => ({ readClaudeRateLimits: mocks.claude }))
vi.mock('./codex', () => ({ readCodexRateLimits: mocks.codex }))
vi.mock('./grok', () => ({ readGrokRateLimits: async () => ({ value: null }) }))
vi.mock('./opencode', () => ({ readOpenCodeGoRateLimits: async () => ({ value: null }) }))
vi.mock('./cursor', () => ({ readCursorRateLimits: async () => ({ value: null }) }))

const { readSubscriptionUsage } = await import('./index')

describe('readSubscriptionUsage', () => {
  beforeEach(() => {
    mocks.claude.mockClear()
    mocks.codex.mockClear()
  })

  it('reads every managed account and names the launch id that runs on it', async () => {
    const rows = await readSubscriptionUsage({
      claudeAccounts: [{ credentialDir: '/claude/b', label: 'b@example.com', apiProviderId: 'claude-account:/claude/b' }],
      codexAccounts: [
        { home: '/codex/a', label: 'a@example.com', apiProviderId: 'codex-account:a' },
        { home: '/codex/b', label: 'b@example.com', apiProviderId: 'codex-account:b' },
      ],
    })

    expect(mocks.codex.mock.calls.map(([opts]) => opts.home)).toEqual(['/codex/a', '/codex/b'])
    expect(rows.map(({ harness, account, apiProviderId }) => ({ harness, account, apiProviderId }))).toEqual([
      { harness: 'claude', account: 'b@example.com', apiProviderId: 'claude-account:/claude/b' },
      { harness: 'codex', account: 'a@example.com', apiProviderId: 'codex-account:a' },
      { harness: 'codex', account: 'b@example.com', apiProviderId: 'codex-account:b' },
    ])
  })

  it('reads only the default logins on a host without managed accounts', async () => {
    const rows = await readSubscriptionUsage({ codexAccounts: [] })

    expect(mocks.claude).toHaveBeenCalledWith(null, expect.anything())
    expect(mocks.codex).toHaveBeenCalledWith(expect.objectContaining({ home: undefined }))
    expect(rows.map(({ harness, account, apiProviderId }) => ({ harness, account, apiProviderId }))).toEqual([
      { harness: 'claude', account: null, apiProviderId: null },
      { harness: 'codex', account: null, apiProviderId: null },
    ])
  })
})
