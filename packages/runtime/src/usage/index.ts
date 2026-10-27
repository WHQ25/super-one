/**
 * Subscription usage of every login this machine's harnesses use, read the
 * same way on a desktop and on a headless node: from the CLI's own stored
 * login, straight against each provider's usage API. No harness process has
 * to run. The desktop process injects Electron `net.fetch` for these reads so
 * they follow the system proxy. A source without a login contributes no row.
 */

import type { ClaudeRateLimits } from '@superone/shared/agent-types'
import type { SubscriptionHarness, SubscriptionUsage } from '@superone/shared/environment'
import { readClaudeRateLimits } from './claude'
import { readCodexRateLimits } from './codex'
import { readCursorRateLimits } from './cursor'
import { readGrokRateLimits } from './grok'
import { silentLog, type UsageLog } from './http'
import { readOpenCodeGoRateLimits } from './opencode'
import { openReadOnlySqlite } from './sqlite-reader'
import type { UsageReading } from './throttle'

export * from './claude'
export * from './codex'
export * from './cursor'
export * from './grok'
export * from './opencode'
export { fetchWithTimeout, setDefaultUsageFetch, silentLog, type UsageFetch, type UsageLog } from './http'
export type { OpenReadOnlyDatabase, ReadOnlyDatabase } from './sqlite-reader'
export { UsageThrottle, type UsageReading } from './throttle'

/** A Claude login to read: `credentialDir` null is the CLI's default login. */
export interface ClaudeUsageAccount {
  credentialDir: string | null
  label: string | null
  /** Launch id of this login; see `SubscriptionUsage.apiProviderId`. */
  apiProviderId?: string | null
}

/** A Codex login to read: `home` undefined is the CLI's default `CODEX_HOME`. */
export interface CodexUsageAccount {
  home?: string
  label: string | null
  apiProviderId?: string | null
}

export interface SubscriptionUsageOptions {
  /** A host without SuperOne-managed accounts omits this and gets the default login only. */
  claudeAccounts?: readonly ClaudeUsageAccount[]
  codexAccounts?: readonly CodexUsageAccount[]
  force?: boolean
  log?: UsageLog
}

interface UsageSource { label: string | null; apiProviderId?: string | null }

const defaultLogin: UsageSource = { label: null }

function row(harness: SubscriptionHarness, source: UsageSource, reading: UsageReading<ClaudeRateLimits>): SubscriptionUsage[] {
  if (!reading.value && !reading.error) return []
  return [{
    harness,
    account: source.label,
    apiProviderId: source.apiProviderId ?? null,
    planType: reading.value?.planType ?? null,
    windows: reading.value?.windows.map(({ label, usedPercent, resetsAt }) => ({ label, usedPercent, resetsAt })) ?? [],
    ...(reading.error ? { error: reading.error } : {}),
  }]
}

async function settle(harness: SubscriptionHarness, source: UsageSource, read: () => Promise<UsageReading<ClaudeRateLimits>>): Promise<SubscriptionUsage[]> {
  try {
    return row(harness, source, await read())
  } catch (error) {
    return row(harness, source, { value: null, error: error instanceof Error ? error.message : String(error) })
  }
}

export async function readSubscriptionUsage(opts: SubscriptionUsageOptions): Promise<SubscriptionUsage[]> {
  const force = opts.force === true
  const log = opts.log ?? silentLog
  const claude = opts.claudeAccounts ?? [{ credentialDir: null, label: null }]
  const codex = opts.codexAccounts?.length ? opts.codexAccounts : [{ label: null }]
  const rows = await Promise.all([
    ...claude.map((account) => settle('claude', account, () => readClaudeRateLimits(account.credentialDir, { force, log }))),
    ...codex.map((account) => settle('codex', account, () => readCodexRateLimits({ home: account.home, force }))),
    settle('grok', defaultLogin, () => readGrokRateLimits({ force, log })),
    settle('opencode', defaultLogin, () => readOpenCodeGoRateLimits(openReadOnlySqlite, { force })),
    settle('cursor', defaultLogin, () => readCursorRateLimits(openReadOnlySqlite, { force })),
  ])
  return rows.flat()
}
