import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ANTIGRAVITY_CLI_ACCOUNT_ID } from '@superone/shared/antigravity-auth'
import { superoneHome } from '../superone-home'

export function resolveAntigravityRoot(customHome?: string): string {
  return join(customHome ?? superoneHome(), 'antigravity')
}

export function resolveAntigravityProfileDir(customHome?: string): string {
  return join(resolveAntigravityRoot(customHome), 'profile')
}

export function resolveAntigravityAccountsDir(customHome?: string): string {
  return join(resolveAntigravityRoot(customHome), 'accounts')
}

export function resolveAntigravityAccountProfileDir(
  accountId: string,
  customHome?: string,
): string | null {
  if (accountId === ANTIGRAVITY_CLI_ACCOUNT_ID) return null
  return join(resolveAntigravityAccountsDir(customHome), accountId)
}

export function resolveAntigravityAccountsIndexPath(customHome?: string): string {
  return join(resolveAntigravityRoot(customHome), 'accounts.json')
}

export function resolveLegacyAntigravityAuthConfigPath(customHome?: string): string {
  return join(resolveAntigravityRoot(customHome), 'auth-config.json')
}

export function listManagedAntigravityProfileDirs(customHome?: string): string[] {
  const dir = resolveAntigravityAccountsDir(customHome)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

export function resolveAntigravityBrainRoots(customHome?: string, home = homedir()): string[] {
  const profileDir = resolveAntigravityProfileDir(customHome)
  const managedDirs = listManagedAntigravityProfileDirs(customHome).flatMap((dir) => [
    join(dir, 'antigravity-acp', 'brain'),
    join(dir, 'brain'),
  ])
  const userGeminiDir = join(home, '.gemini')
  if (customHome) {
    return [
      ...managedDirs,
      join(profileDir, 'antigravity-acp', 'brain'),
      join(profileDir, 'brain'),
      join(userGeminiDir, 'antigravity-cli', 'brain'),
      join(userGeminiDir, 'antigravity', 'brain'),
    ]
  }
  return [
    ...managedDirs,
    join(userGeminiDir, 'antigravity-cli', 'brain'),
    join(userGeminiDir, 'antigravity', 'brain'),
    join(profileDir, 'antigravity-acp', 'brain'),
    join(profileDir, 'brain'),
  ]
}

export function candidateTokenPathsForAccount(
  accountId: string,
  customHome?: string,
  home = homedir(),
): string[] {
  const profileDir = resolveAntigravityAccountProfileDir(accountId, customHome)
  if (profileDir) {
    return [
      join(profileDir, 'antigravity-acp', 'acp_token.json'),
      join(profileDir, 'antigravity-acp', 'oauth_creds.json'),
      join(profileDir, 'oauth_creds.json'),
    ]
  }
  const legacyDir = resolveAntigravityProfileDir(customHome)
  const paths = [
    join(legacyDir, 'oauth_creds.json'),
    join(legacyDir, 'antigravity-acp', 'acp_token.json'),
  ]
  if (!customHome) {
    paths.unshift(
      join(home, '.gemini', 'oauth_creds.json'),
      join(home, '.gemini', 'antigravity-cli', 'acp_token.json'),
      join(home, '.gemini', 'antigravity-cli', 'oauth_creds.json'),
    )
  }
  return paths
}

export function hasValidTokenFile(tokenPath: string): boolean {
  if (!existsSync(tokenPath)) return false
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
      refresh_token?: unknown
      access_token?: unknown
      token?: unknown
    }
    return (
      (typeof parsed.refresh_token === 'string' && parsed.refresh_token.trim().length > 0) ||
      (typeof parsed.access_token === 'string' && parsed.access_token.trim().length > 0) ||
      (typeof parsed.token === 'string' && parsed.token.trim().length > 0)
    )
  } catch {
    return false
  }
}

export function readEmailFromTokenFile(tokenPath: string): string | undefined {
  if (!existsSync(tokenPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
      email?: unknown
      account?: unknown
      id_token?: unknown
    }
    const direct =
      (typeof parsed.email === 'string' && parsed.email.trim()) ||
      (typeof parsed.account === 'string' && parsed.account.trim()) ||
      undefined
    if (direct && direct.includes('@')) return direct
    if (typeof parsed.id_token === 'string') {
      const parts = parsed.id_token.split('.')
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
          email?: unknown
        }
        return typeof payload.email === 'string' && payload.email.trim()
          ? payload.email.trim()
          : undefined
      }
    }
  } catch {
    return undefined
  }
  return undefined
}
