/**
 * Subscription usage of every login this machine's harnesses use, read the
 * same way on a desktop and on a headless node: from the CLI's own stored
 * login, straight against each provider's usage API. No harness process has
 * to run. A source without a login contributes no row.
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
export { fetchWithTimeout, silentLog, type UsageLog } from './http'
export type { OpenReadOnlyDatabase, ReadOnlyDatabase } from './sqlite-reader'
export type { UsageReading } from './throttle'

/** A Claude login to read: `credentialDir` null is the CLI's default login. */
export interface ClaudeUsageAccount {
  credentialDir: string | null
  label: string | null
}

export interface SubscriptionUsageOptions {
  /** A host without SuperOne-managed accounts omits this and gets the default login only. */
  claudeAccounts?: readonly ClaudeUsageAccount[]
  force?: boolean
  log?: UsageLog
}

function row(harness: SubscriptionHarness, account: string | null, reading: UsageReading<ClaudeRateLimits>): SubscriptionUsage[] {
  if (!reading.value && !reading.error) return []
  return [{
    harness,
    account,
    planType: reading.value?.planType ?? null,
    windows: reading.value?.windows.map(({ label, usedPercent, resetsAt }) => ({ label, usedPercent, resetsAt })) ?? [],
    ...(reading.error ? { error: reading.error } : {}),
  }]
}

async function settle(harness: SubscriptionHarness, account: string | null, read: () => Promise<UsageReading<ClaudeRateLimits>>): Promise<SubscriptionUsage[]> {
  try {
    return row(harness, account, await read())
  } catch (error) {
    return row(harness, account, { value: null, error: error instanceof Error ? error.message : String(error) })
  }
}

export async function readSubscriptionUsage(opts: SubscriptionUsageOptions): Promise<SubscriptionUsage[]> {
  const force = opts.force === true
  const log = opts.log ?? silentLog
  const claude = opts.claudeAccounts ?? [{ credentialDir: null, label: null }]
  const rows = await Promise.all([
    ...claude.map((account) => settle('claude', account.label, () => readClaudeRateLimits(account.credentialDir, { force, log }))),
    settle('codex', null, () => readCodexRateLimits({ force })),
    settle('grok', null, () => readGrokRateLimits({ force, log })),
    settle('opencode', null, () => readOpenCodeGoRateLimits(openReadOnlySqlite, { force })),
    settle('cursor', null, () => readCursorRateLimits(openReadOnlySqlite, { force })),
  ])
  return rows.flat()
}
