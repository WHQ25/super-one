import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ClaudeAccount } from '@superone/shared/agent-types'
import { isClaudeAccountProvider, claudeAccountCredentialDir } from '@superone/shared/agent-types'
import { resolveSdkClaudeBinary } from './claude-binary'
import { dedupeAccounts } from './claude-account-parse'
import { claudeAccountStore } from './claude-account-store'
import { readClaudeAccount } from './claude-account-profile'
import { loadCredentials } from './claude-oauth'

const STATUS_TIMEOUT_MS = 15_000
const LOGIN_TIMEOUT_MS = 5 * 60_000
let login: AbortController | null = null
export function accountsRoot(): string { return claudeAccountStore().root }

/** Auth commands isolate both stores. Sessions share transcripts through the managed home. */
export function authEnv(dir: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']) delete env[name]
  if (dir) { env.CLAUDE_SECURESTORAGE_CONFIG_DIR = dir; env.CLAUDE_CONFIG_DIR = dir }
  return env
}
function runAuth(args: string[], dir: string, timeout: number, signal?: AbortSignal): Promise<void> {
  const binary = resolveSdkClaudeBinary()
  if (!binary) throw new Error('Claude runtime is unavailable')
  return new Promise((resolve, reject) => {
    execFile(binary, ['auth', ...args], { env: authEnv(dir), timeout, signal, encoding: 'utf8' }, (error) => {
      // Never include CLI output: it may carry a login URL or credentials.
      if (error) reject(new Error(signal?.aborted ? 'Claude sign-in cancelled' : `Claude auth ${args[0]} failed`))
      else resolve()
    })
  })
}
export const readAccount = readClaudeAccount
const LIST_CACHE_TTL_MS = 60_000
let listGeneration = 0
let listCache: { accounts: ClaudeAccount[]; at: number } | null = null
export function invalidateAccountListCache(): void { listCache = null; listGeneration++ }
export async function listAccounts(force = false): Promise<ClaudeAccount[]> {
  if (!force && listCache && Date.now() - listCache.at < LIST_CACHE_TTL_MS) return listCache.accounts
  const store = claudeAccountStore()
  const generation = listGeneration
  // Read the external CLI first so existing installations retain their initial default.
  const cli = await readAccount(null, force)
  const accounts = [...(cli.loggedIn || cli.email ? [cli] : []), ...await Promise.all(store.dirs().map((dir) => readAccount(dir, force)))]
  const resolved = dedupeAccounts(accounts).map((account) => ({ ...account, isDefault: store.isDefault(account.credentialDir) }))
  if (generation === listGeneration) listCache = { accounts: resolved, at: Date.now() }
  return resolved
}
export function createAccountDir(): string {
  const dir = join(accountsRoot(), randomUUID())
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
export async function signInAccount(dir: string, email?: string | null): Promise<ClaudeAccount | null> {
  const store = claudeAccountStore()
  store.assertManaged(dir)
  if (login) throw new Error('A Claude sign-in is already in progress')
  const previousIdentity = store.get(dir)?.account.identityKey
  const controller = new AbortController()
  login = controller
  try {
    const args = ['login', '--claudeai']
    if (email?.trim()) args.push('--email', email.trim())
    await runAuth(args, dir, LOGIN_TIMEOUT_MS, controller.signal)
    const account = await readAccount(dir, true)
    if (store.get(dir)?.identityMismatch) throw new Error('This profile belongs to another Claude account. Add the other account separately.')
    if (!account.loggedIn) throw new Error('Claude sign-in did not complete')
    if (previousIdentity && account.identityKey && previousIdentity !== account.identityKey) {
      store.update(dir, { account: { ...account, loggedIn: false, identityStatus: 'signedOut' } })
      throw new Error('This profile belongs to another Claude account. Add the other account separately.')
    }
    return account
  } finally { if (login === controller) login = null; invalidateAccountListCache() }
}
export function cancelSignIn(): void { login?.abort() }
export async function signOutAccount(dir: string): Promise<void> {
  claudeAccountStore().assertManaged(dir)
  await runAuth(['logout'], dir, STATUS_TIMEOUT_MS)
  // Keep the domain and last identity so the user can reauthenticate the same card/session.
  await readAccount(dir, true)
  invalidateAccountListCache()
}
export async function setDefaultAccount(dir: string | null): Promise<void> {
  const account = await readAccount(dir)
  if (!account.loggedIn) throw new Error('Sign in before selecting a default Claude account')
  claudeAccountStore().setDefault(dir)
  invalidateAccountListCache()
}

/** An explicit OAuth choice must override inherited proxy/API/environment credentials. */
export function claudeAccountConfig(id: string | null): { extraEnv: Record<string, string> } | null {
  if (!isClaudeAccountProvider(id)) return null
  const dir = claudeAccountCredentialDir(id)
  if (dir) {
    const store = claudeAccountStore()
    store.assertManaged(dir)
    if (!loadCredentials(dir)?.oauth.accessToken || store.get(dir)?.account.loggedIn === false) throw new Error('Please sign in to this Claude account before continuing')
    const known = store.get(dir)
    if (known?.ownerIdentity && !known.account.identityKey) throw new Error('Unable to verify this Claude account. Refresh accounts before continuing.')
    store.prepareSessionHome(dir)
  }
  return { extraEnv: {
    CLAUDE_SECURESTORAGE_CONFIG_DIR: dir ?? process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? '',
    ...(dir ? { CLAUDE_CONFIG_DIR: dir } : {}),
    ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '',
    CLAUDE_CODE_OAUTH_TOKEN: dir ? '' : process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',
    CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_FOUNDRY: '0',
  } }
}
