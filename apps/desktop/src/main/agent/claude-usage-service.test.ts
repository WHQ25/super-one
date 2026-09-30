import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const auth = vi.hoisted(() => ({ email: 'a@example.test' }))
vi.mock('node:child_process', () => ({
  execFileSync: () => { throw new Error('No test keychain') },
  execFile: (_file: string, _args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
    callback(null, JSON.stringify({ loggedIn: true, email: auth.email, orgId: 'org-test', apiProvider: 'firstParty' }), '')
  },
}))

import { getClaudeRateLimits } from './claude-usage-service'

let dir: string
const start = Date.UTC(2026, 8, 30)
function credentials(token: string) {
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token, scopes: ['user:profile'], subscriptionType: 'max' } }))
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
  vi.stubEnv('SUPERONE_CLAUDE_BINARY', '/test/claude')
  auth.email = `a-${Math.random()}@example.test`
  dir = mkdtempSync(join(tmpdir(), 'usage-samples-'))
  credentials('test-token-a')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('Claude subscription sampling at the source', () => {
  it('ignores cached polls and failed requests, then discards the cached account after another login', async () => {
    let used = 70
    const fetch = vi.fn(async () => new Response(JSON.stringify({ seven_day: { utilization: used, resets_at: new Date(start + 86400_000).toISOString() } })))
    vi.stubGlobal('fetch', fetch)
    let reading = await getClaudeRateLimits(false, dir)
    expect(reading?.windows[0].forecast?.basis).toBe('cycle-average')
    expect(reading?.windows[0].forecast?.confirmed).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    for (let m = 1; m < 5; m++) {
      vi.setSystemTime(start + m * 60_000)
      expect((await getClaudeRateLimits(false, dir))?.fetchedAt).toBe(start)
    }
    expect(fetch).toHaveBeenCalledTimes(1)
    for (let m = 5; m <= 25; m += 5) {
      vi.setSystemTime(start + m * 60_000)
      used += 2
      reading = await getClaudeRateLimits(false, dir)
    }
    expect(reading?.windows[0].forecast?.confirmed).toBe(true)
    const sampledAt = reading!.fetchedAt
    const quotaKey = reading!.quotaKey
    vi.setSystemTime(start + 30 * 60_000)
    fetch.mockImplementationOnce(async () => new Response('', { status: 429, headers: { 'retry-after': '300' } }))
    expect((await getClaudeRateLimits(false, dir))?.fetchedAt).toBe(sampledAt)
    auth.email = 'another@example.test'
    credentials('test-token-b')
    used = 20
    const switched = await getClaudeRateLimits(false, dir)
    expect(switched?.quotaKey).not.toBe(quotaKey)
    expect(switched?.windows[0].usedPercent).toBe(20)
    expect(switched?.windows[0].forecast?.basis).toBe('cycle-average')
    expect(switched?.windows[0].forecast?.confirmed).toBe(false)
  })
})
