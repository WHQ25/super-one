import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claudeAccountProviderId, CLAUDE_CLI_ACCOUNT_PROVIDER_ID } from '@superone/shared/agent-types'
const fixture = vi.hoisted(() => ({ home: '', calls: [] as Array<{ args: string[]; env: NodeJS.ProcessEnv }> }))
vi.mock('../superone-home', () => ({ superoneHome: () => fixture.home }))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('./claude-binary', () => ({ resolveSdkClaudeBinary: () => '/fixture/claude' }))
vi.mock('node:child_process', () => ({
  execFileSync: () => { throw new Error('No fixture keychain') },
  execFile: (_binary: string, args: string[], options: { env: NodeJS.ProcessEnv }, done: (error: null) => void) => {
    fixture.calls.push({ args, env: options.env })
    if (args[1] === 'logout') unlinkSync(join(options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR!, '.credentials.json'))
    done(null)
  },
}))
import { authEnv, claudeAccountConfig, createAccountDir, invalidateAccountListCache, listAccounts, readAccount, setDefaultAccount, signInAccount, signOutAccount } from './claude-account-service'
import { claudeAccountStore } from './claude-account-store'

function credentials(dir: string, token: string) {
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token, scopes: ['user:profile'], subscriptionType: 'max' } }))
}
function profile(account: string, org = 'org') { return { account: { uuid: account, email: `${account}@example.test` }, organization: { uuid: org, name: org } } }
beforeEach(() => {
  fixture.home = mkdtempSync(join(tmpdir(), 'claude-accounts-test-')); fixture.calls = []
  const shared = join(fixture.home, 'shared'); mkdirSync(shared)
  vi.stubEnv('CLAUDE_CONFIG_DIR', shared)
  writeFileSync(join(shared, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'wrong@shared.test' }, mcpServers: { shared: { command: 'example' } } }))
  writeFileSync(join(shared, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'wrong-key' } }))
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(profile(String((init.headers as Record<string, string>).Authorization).replace('Bearer ', ''))))))
  invalidateAccountListCache()
})
afterEach(() => { rmSync(fixture.home, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Claude managed account lifecycle', () => {
  it('recovers two legacy credential domains from their own tokens, not the shared profile', async () => {
    const a = createAccountDir(), b = createAccountDir(); credentials(a, 'a'); credentials(b, 'b')
    const accounts = await listAccounts(true)
    expect(accounts.filter((row) => row.loggedIn).map((row) => row.email).sort()).toEqual(['a@example.test', 'b@example.test'])
    expect(accounts.find((row) => row.credentialDir === a)?.identityKey).toBe('a|org')
    expect(fixture.calls).toEqual([])
  })
  it('persists the chosen default, scopes actual query credentials, and shares resume history', async () => {
    const a = createAccountDir(), b = createAccountDir(); credentials(a, 'a'); credentials(b, 'b')
    await listAccounts(true); await setDefaultAccount(b)
    expect(claudeAccountStore().defaultProviderId()).toBe(claudeAccountProviderId(b))
    expect((await listAccounts()).find((row) => row.isDefault)?.credentialDir).toBe(b)
    const config = claudeAccountConfig(claudeAccountProviderId(b))!
    expect(config.extraEnv).toMatchObject({ CLAUDE_SECURESTORAGE_CONFIG_DIR: b, CLAUDE_CONFIG_DIR: b, ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: '' })
    expect(realpathSync(join(b, 'projects'))).toBe(realpathSync(join(fixture.home, 'shared', 'projects')))
    expect(JSON.parse(readFileSync(join(b, '.claude.json'), 'utf8'))).toMatchObject({ oauthAccount: { emailAddress: 'b@example.test' }, mcpServers: { shared: { command: 'example' } } })
    expect(claudeAccountConfig(CLAUDE_CLI_ACCOUNT_PROVIDER_ID)?.extraEnv.CLAUDE_CONFIG_DIR).toBeUndefined()
  })
  it('preserves both accounts during a profile outage and never merges unverified domains', async () => {
    const a = createAccountDir(), b = createAccountDir(); credentials(a, 'a'); credentials(b, 'b')
    await listAccounts(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline') }))
    const accounts = await listAccounts(true)
    expect(accounts.filter((row) => row.loggedIn)).toHaveLength(2)
    expect(accounts.find((row) => row.credentialDir === b)).toMatchObject({ email: 'b@example.test', identityStatus: 'unavailable' })
    credentials(b, 'replacement')
    expect((await listAccounts(true)).find((row) => row.credentialDir === b)?.identityKey).toBeNull()
  })
  it('isolates login/logout config, keeps signed-out cards, and refuses to silently use another account', async () => {
    const dir = createAccountDir(); credentials(dir, 'b')
    const sharedBefore = readFileSync(join(fixture.home, 'shared', '.claude.json'), 'utf8')
    await signInAccount(dir); await setDefaultAccount(dir); await signOutAccount(dir)
    expect(fixture.calls.map((call) => call.env.CLAUDE_CONFIG_DIR)).toEqual([dir, dir])
    expect(readFileSync(join(fixture.home, 'shared', '.claude.json'), 'utf8')).toBe(sharedBefore)
    expect((await listAccounts(true)).find((row) => row.credentialDir === dir)).toMatchObject({ loggedIn: false, email: 'b@example.test', isDefault: true })
    expect(() => claudeAccountConfig(claudeAccountProviderId(dir))).toThrow(/sign in/)
    expect(claudeAccountStore().defaultProviderId()).toBe(claudeAccountProviderId(dir))
  })
  it('does not overwrite a replacement token identity with an earlier profile response', async () => {
    const dir = createAccountDir(); credentials(dir, 'a')
    let finish!: (value: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const earlier = readAccount(dir, true)
    credentials(dir, 'b')
    expect((await readAccount(dir, true)).email).toBe('b@example.test')
    finish(new Response(JSON.stringify(profile('a'))))
    expect((await earlier).email).toBe('b@example.test')
    expect(claudeAccountStore().get(dir)?.account.email).toBe('b@example.test')
  })
  it('shares token renewal between profile and usage and uses the renewed token for both', async () => {
    const dir = createAccountDir()
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'old', refreshToken: 'refresh-old', expiresAt: 1, scopes: ['user:profile'] } }))
    const network = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'refresh-new', expires_in: 3600 }))
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer new')
      return new Response(JSON.stringify(url.endsWith('/profile') ? profile('b') : { five_hour: { utilization: 20, resets_at: new Date(Date.now() + 3600_000).toISOString() } }))
    })
    vi.stubGlobal('fetch', network)
    const { getClaudeRateLimits } = await import('./claude-usage-service')
    const [account, limits] = await Promise.all([readAccount(dir, true), getClaudeRateLimits(false, dir)])
    expect(account.email).toBe('b@example.test')
    expect(limits?.windows[0]?.usedPercent).toBe(20)
    expect(network.mock.calls.filter(([url]) => url.endsWith('/token'))).toHaveLength(1)
  })
  it('keeps a managed profile bound to its original owner across failed re-login attempts', async () => {
    const dir = createAccountDir(); credentials(dir, 'a'); await readAccount(dir, true)
    credentials(dir, 'b')
    await expect(signInAccount(dir)).rejects.toThrow(/another Claude account/)
    await expect(signInAccount(dir)).rejects.toThrow(/another Claude account/)
    expect(claudeAccountStore().get(dir)?.ownerIdentity).toBe('a|org')
    expect(() => claudeAccountConfig(claudeAccountProviderId(dir))).toThrow(/sign in/)
  })
  it('refuses account paths outside the registry and clears inherited login credentials', () => {
    expect(() => claudeAccountConfig('claude-account:/somewhere-else')).toThrow(/Unknown/)
    vi.stubEnv('ANTHROPIC_API_KEY', 'ambient-key'); vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'ambient-token')
    expect(authEnv(createAccountDir()).ANTHROPIC_API_KEY).toBeUndefined()
    expect(authEnv(createAccountDir()).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  })
})
