import { execFile } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ClaudeAccount } from '@superone/shared/agent-types'
import { isClaudeAccountProvider, claudeAccountCredentialDir } from '@superone/shared/agent-types'
import { resolveSdkClaudeBinary } from './claude-binary'
import { dedupeAccounts } from './claude-account-parse'
import { claudeAccountStore } from './claude-account-store'
import { readClaudeAccount } from './claude-account-profile'
import { loadClaudeCredentials } from '@superone/runtime/usage'
import { usageLog } from './usage-log'

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

const accountChangeListeners = new Set<() => void>()

/**
 * Subscribe to local account mutations. This function does not drop the list
 * cache; `notifyClaudeAccountsChanged` drops it before these listeners run.
 */
export function onClaudeAccountsChanged(listener: () => void): () => void {
  accountChangeListeners.add(listener)
  return () => { accountChangeListeners.delete(listener) }
}

function notifyClaudeAccountsChanged(): void {
  invalidateAccountListCache()
  for (const listener of accountChangeListeners) listener()
}
export async function listAccounts(force = false): Promise<ClaudeAccount[]> {
  if (!force && listCache && Date.now() - listCache.at < LIST_CACHE_TTL_MS) return listCache.accounts
  const store = claudeAccountStore()
  const generation = listGeneration
  // Read the external CLI first so existing installations retain their initial default.
  const cli = await readAccount(null, force)
  // A signed-out CLI login belongs to the external CLI; SuperOne can neither renew nor remove it.
  const accounts = [...(cli.loggedIn ? [cli] : []), ...await Promise.all(store.dirs().map((dir) => readAccount(dir, force)))]
  const resolved = dedupeAccounts(accounts, (account) => account.credentialDir && store.get(account.credentialDir)?.ownerIdentity).map((account) => ({ ...account, isDefault: store.isDefault(account.credentialDir) }))
  if (generation === listGeneration) listCache = { accounts: resolved, at: Date.now() }
  return resolved
}
/**
 * Signed-in accounts as last recorded in the registry, without probing credentials,
 * for synchronous catalogs. `listAccounts` refreshes the same records.
 */
export function listKnownAccounts(): ClaudeAccount[] {
  const store = claudeAccountStore()
  const accounts = [null, ...store.dirs()].flatMap((dir) => {
    const account = store.get(dir)?.account
    return account ? [{ ...account, isDefault: store.isDefault(dir) }] : []
  })
  return dedupeAccounts(accounts).filter((account) => account.loggedIn)
}
export function createAccountDir(): string {
  const dir = join(accountsRoot(), randomUUID())
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
/** A new card exists only once its sign-in succeeds. */
export async function addAccount(email?: string | null): Promise<ClaudeAccount | null> {
  const dir = createAccountDir()
  try { return await signInAccount(dir, email) }
  catch (error) { await removeAccount(dir).catch(() => {}); throw error }
}
export async function signInAccount(dir: string, email?: string | null): Promise<ClaudeAccount | null> {
  const store = claudeAccountStore()
  store.assertManaged(dir)
  if (login) throw new Error('A Claude sign-in is already in progress')
  const previousIdentity = store.get(dir)?.account.identityKey
  const controller = new AbortController()
  login = controller
  let signedIn: ClaudeAccount
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
    signedIn = account
  } finally { if (login === controller) login = null; notifyClaudeAccountsChanged() }
  // One identity keeps one card: signed-out domains this login supersedes are retired.
  const identity = signedIn.identityKey
  if (identity) {
    for (const other of store.dirs()) {
      const known = store.get(other)
      if (other === dir || known?.ownerIdentity !== identity || known.account.loggedIn) continue
      const wasDefault = store.isDefault(other)
      await deleteAccountDir(other).then(() => { if (wasDefault) store.setDefault(dir) }, () => {})
    }
  }
  return signedIn
}
export function cancelSignIn(): void { login?.abort() }
export async function signOutAccount(dir: string): Promise<void> {
  claudeAccountStore().assertManaged(dir)
  await runAuth(['logout'], dir, STATUS_TIMEOUT_MS)
  // Keep the domain and last identity so the user can reauthenticate the same card/session.
  await readAccount(dir, true)
  notifyClaudeAccountsChanged()
}
/** Revokes the domain's own credentials before deleting it; shared transcripts are only linked in. */
export async function removeAccount(dir: string): Promise<void> {
  claudeAccountStore().assertManaged(dir)
  if (login) throw new Error('Finish or cancel the current Claude sign-in first.')
  await deleteAccountDir(dir)
}
async function deleteAccountDir(dir: string): Promise<void> {
  // A signed-out or mismatched domain may still hold another identity's token.
  await runAuth(['logout'], dir, STATUS_TIMEOUT_MS).catch(() => {})
  rmSync(dir, { recursive: true, force: true })
  claudeAccountStore().forget(dir)
  notifyClaudeAccountsChanged()
}
export async function setDefaultAccount(dir: string | null): Promise<void> {
  const account = await readAccount(dir)
  if (!account.loggedIn) throw new Error('Sign in before selecting a default Claude account')
  claudeAccountStore().setDefault(dir)
  notifyClaudeAccountsChanged()
}

/**
 * An explicit OAuth choice must override inherited proxy/API/environment credentials.
 * `CLAUDE_CODE_ARTIFACT` opts SDK hosts into the claude.ai-published Artifact tool, which the
 * CLI withholds from SDK entrypoints by default; account flags and org policy still apply.
 */
export function claudeAccountConfig(id: string | null): { extraEnv: Record<string, string> } | null {
  if (!isClaudeAccountProvider(id)) return null
  const dir = claudeAccountCredentialDir(id)
  if (dir) {
    const store = claudeAccountStore()
    store.assertManaged(dir)
    if (!loadClaudeCredentials(dir, usageLog)?.oauth.accessToken || store.get(dir)?.account.loggedIn === false) throw new Error('Please sign in to this Claude account before continuing')
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
    CLAUDE_CODE_ARTIFACT: '1',
  } }
}
