import type { SubscriptionUsage } from '@superone/shared/environment'
import { claudeAccountProviderId } from '@superone/shared/agent-types'
import { codexAccountProviderId } from '@superone/shared/codex-accounts'
import { readSubscriptionUsage, type ClaudeUsageAccount, type CodexUsageAccount } from '@superone/runtime/usage'
import { codexAccountStore } from '../codex/codex-account-store'
import { installClaudeUsageFetch } from './claude-usage-fetch'
import { usageLog } from './usage-log'

installClaudeUsageFetch()

/** Every signed-in Claude account SuperOne manages, labelled by email, instead of only the CLI's default login. */
export async function claudeUsageAccounts(): Promise<ClaudeUsageAccount[]> {
  const { listAccounts } = await import('./claude-account-service')
  return (await listAccounts()).filter((account) => account.loggedIn).map((account) => ({
    credentialDir: account.credentialDir,
    label: account.email,
    apiProviderId: claudeAccountProviderId(account.credentialDir),
  }))
}

/** Every signed-in Codex account SuperOne manages; empty leaves the CLI's default login. */
export async function codexUsageAccounts(): Promise<CodexUsageAccount[]> {
  const store = codexAccountStore()
  return store.list().filter((account) => account.signedIn).map((account) => ({
    home: store.home(account.id),
    label: account.email,
    apiProviderId: codexAccountProviderId(account.id),
  }))
}

/** This desktop's subscription usage — the same reading its node serves as `environment.usage`. */
export async function readLocalSubscriptionUsage(force = false): Promise<SubscriptionUsage[]> {
  const [claudeAccounts, codexAccounts] = await Promise.all([claudeUsageAccounts(), codexUsageAccounts()])
  return readSubscriptionUsage({ claudeAccounts, codexAccounts, force, log: usageLog })
}
