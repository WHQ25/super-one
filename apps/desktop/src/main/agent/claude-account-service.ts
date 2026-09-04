import { execFile } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ClaudeAccount } from '@superone/shared/agent-types'
import log from '../logger'
import { resolveSdkClaudeBinary } from './claude-binary'
import { dedupeAccounts, parseAuthStatus } from './claude-account-parse'

/**
 * Multi-account support rides on `CLAUDE_SECURESTORAGE_CONFIG_DIR`, which redirects the keychain
 * entry and `.credentials.json` on its own — `CLAUDE_CONFIG_DIR` is deliberately left alone, so
 * `~/.claude/projects` and every transcript stay shared and resume keeps working across accounts.
 *
 * That variable is undocumented (Anthropic groups it with KUBECONFIG / SSH_AUTH_SOCK as a
 * credential-redirect var). Treat it as load-bearing but unverified: always confirm which account
 * a domain actually resolves to via `claude auth status --json` instead of assuming the env took.
 */
const SECURESTORAGE_ENV = 'CLAUDE_SECURESTORAGE_CONFIG_DIR'
const ACCOUNTS_DIRNAME = 'claude-accounts'
const STATUS_TIMEOUT_MS = 15_000
/** Sign-in waits on a human in a browser, so it gets a far longer leash than a status read. */
const LOGIN_TIMEOUT_MS = 5 * 60_000

/**
 * `~/.superone/claude-accounts`. Deliberately not under `userData`: the keychain service name is a
 * hash of this path, and `userData` differs between dev and packaged builds, which would silently
 * strand every account added in the other build.
 */
export function accountsRoot(): string {
  return join(homedir(), '.superone', ACCOUNTS_DIRNAME)
}

function authEnv(credentialDir: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (credentialDir) env[SECURESTORAGE_ENV] = credentialDir
  else delete env[SECURESTORAGE_ENV]
  return env
}

function runAuth(args: string[], credentialDir: string | null, timeoutMs: number): Promise<string | null> {
  const binary = resolveSdkClaudeBinary()
  if (!binary) {
    log.warn('[claude-account] no claude binary resolved; skipping %s', args.join(' '))
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    execFile(binary, ['auth', ...args], { env: authEnv(credentialDir), timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      // `auth status` exits 0 for a signed-out domain and still prints JSON, so a non-zero exit is
      // a real failure (missing binary, timeout, crash) — but stdout may still carry a usable body.
      if (error && !stdout) {
        log.warn('[claude-account] auth %s failed: %s', args[0], (stderr || String(error)).trim())
        resolve(null)
        return
      }
      resolve(stdout)
    })
  })
}

/** Identity of one credential domain. `null` reads the CLI's own default login. */
export async function readAccount(credentialDir: string | null): Promise<ClaudeAccount | null> {
  const stdout = await runAuth(['status', '--json'], credentialDir, STATUS_TIMEOUT_MS)
  if (stdout == null) return null
  return parseAuthStatus(stdout, credentialDir)
}

function managedAccountDirs(): string[] {
  try {
    return readdirSync(accountsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(accountsRoot(), entry.name))
      .sort()
  } catch {
    return []
  }
}

/**
 * Cached because each entry costs one `claude auth status` subprocess, and the provider dropdown
 * asks on every mount. Sign-in / sign-out invalidate it directly, so the TTL only covers changes
 * made outside SuperOne (a `claude /login` in the user's own terminal).
 */
const LIST_CACHE_TTL_MS = 60_000
let listCache: { accounts: ClaudeAccount[]; at: number } | null = null

export function invalidateAccountListCache(): void {
  listCache = null
}

/**
 * Every account SuperOne can see: the CLI's default login first (it stays `apiProviderId: null`,
 * so existing sessions keep their meaning), then each managed credential domain.
 */
export async function listAccounts(force = false): Promise<ClaudeAccount[]> {
  if (!force && listCache && Date.now() - listCache.at < LIST_CACHE_TTL_MS) return listCache.accounts
  const dirs: Array<string | null> = [null, ...managedAccountDirs()]
  const accounts = await Promise.all(dirs.map((dir) => readAccount(dir)))
  const resolved = dedupeAccounts(accounts.filter((account): account is ClaudeAccount => account != null))
  listCache = { accounts: resolved, at: Date.now() }
  return resolved
}

/** Allocate an empty credential domain for a sign-in that hasn't happened yet. */
export function createAccountDir(): string {
  const dir = join(accountsRoot(), randomUUID())
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Drive `claude auth login` inside a credential domain. The CLI starts its own OAuth callback
 * server and opens the browser, so there is nothing for us to relay — we just wait, then report
 * what the domain actually resolves to.
 */
export async function signInAccount(credentialDir: string, email?: string | null): Promise<ClaudeAccount | null> {
  const args = ['login', '--claudeai']
  const trimmed = email?.trim()
  if (trimmed) args.push('--email', trimmed)
  await runAuth(args, credentialDir, LOGIN_TIMEOUT_MS)
  invalidateAccountListCache()
  return readAccount(credentialDir)
}

/**
 * Sign a managed domain out and drop its directory. Refuses the default domain: that is the CLI's
 * own login, and taking it away here would sign the user out of `claude` in their terminal too.
 */
export async function signOutAccount(credentialDir: string): Promise<void> {
  if (!credentialDir.startsWith(accountsRoot())) {
    throw new Error('Refusing to sign out a credential domain SuperOne does not manage')
  }
  await runAuth(['logout'], credentialDir, STATUS_TIMEOUT_MS)
  rmSync(credentialDir, { recursive: true, force: true })
  invalidateAccountListCache()
}
