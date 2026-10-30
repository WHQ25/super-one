import {
  CLAUDE_CLI_ACCOUNT_PROVIDER_ID,
  claudeAccountCredentialDir,
  isClaudeAccountProvider,
} from '@superone/shared/agent-types'

/**
 * Env for a metadata probe of one Claude account. The Agent SDK uses `options.env`
 * as the whole child environment, so this copies `process.env` and then overlays
 * the account. A third-party credential is not a Claude login; callers skip the
 * probe, and this returns undefined so the SDK inherits the process env itself.
 * The overlay matches the desktop account launch env: the named domain wins over
 * an inherited API key.
 */
export function claudeAccountProbeEnv(
  apiProviderId: string | null | undefined,
): Record<string, string | undefined> | undefined {
  if (!apiProviderId || !isClaudeAccountProvider(apiProviderId)) return undefined
  const dir = claudeAccountCredentialDir(apiProviderId)
  return {
    ...process.env,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: dir ?? process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? '',
    ...(dir ? { CLAUDE_CONFIG_DIR: dir } : {}),
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: '',
    CLAUDE_CODE_OAUTH_TOKEN: dir ? '' : process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',
    CLAUDE_CODE_USE_BEDROCK: '0',
    CLAUDE_CODE_USE_VERTEX: '0',
    CLAUDE_CODE_USE_FOUNDRY: '0',
  }
}

/**
 * Non-secret cache discriminator for a Claude probe: `inherit`, `cli`, or
 * `dir:<credential dir>`. Do not read this from the env bag. After the probe
 * copies `process.env`, a CLI login and an inherited login can share
 * `CLAUDE_CONFIG_DIR`.
 */
export function claudeCatalogCacheScope(apiProviderId: string | null | undefined): string {
  if (!isClaudeAccountProvider(apiProviderId)) return 'inherit'
  if (apiProviderId === CLAUDE_CLI_ACCOUNT_PROVIDER_ID) return 'cli'
  const dir = claudeAccountCredentialDir(apiProviderId)
  return dir ? `dir:${dir}` : 'inherit'
}
