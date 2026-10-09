import type { SubscriptionUsage } from '@superone/shared/environment'
import { readSubscriptionUsage, type ClaudeUsageAccount } from '@superone/runtime/usage'
import { usageLog } from './usage-log'

/** Every signed-in Claude account SuperOne manages, labelled by email, instead of only the CLI's default login. */
export async function claudeUsageAccounts(): Promise<ClaudeUsageAccount[]> {
  const { listAccounts } = await import('./claude-account-service')
  return (await listAccounts()).filter((account) => account.loggedIn).map((account) => ({ credentialDir: account.credentialDir, label: account.email }))
}

/** This desktop's subscription usage — the same reading its node serves as `environment.usage`. */
export async function readLocalSubscriptionUsage(force = false): Promise<SubscriptionUsage[]> {
  return readSubscriptionUsage({ claudeAccounts: await claudeUsageAccounts(), force, log: usageLog })
}
