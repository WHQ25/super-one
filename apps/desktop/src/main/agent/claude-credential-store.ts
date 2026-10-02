import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import log from '../logger'
import { keychainServiceNames } from './claude-account-parse'

const CRED_FILE_NAME = '.credentials.json'

/** The Claude CLI's credential JSON: `claudeAiOauth`, `mcpOAuth`, and keys SuperOne does not read. */
export type ClaudeCredentialData = Record<string, unknown>

export interface ClaudeCredentialStore {
  source: 'keychain' | 'file'
  /** Keychain service and account the data came from; `null` for the file. */
  serviceName: string | null
  account: string | null
  data: ClaudeCredentialData
}

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
}

/** `.credentials.json` for one domain. The CLI keeps it inside the securestorage dir. */
export function claudeCredentialsPath(credentialDir: string | null): string {
  return join(credentialDir ?? configDir(), CRED_FILE_NAME)
}

function tryParseJson(text: string): ClaudeCredentialData | null {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ClaudeCredentialData : null
  } catch {
    return null
  }
}

/** `security -w` hex-encodes values containing newlines. */
function parseCredentialJson(text: string | null): ClaudeCredentialData | null {
  if (!text) return null
  const direct = tryParseJson(text)
  if (direct) return direct
  let hex = text.trim()
  if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2)
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  return tryParseJson(Buffer.from(hex, 'hex').toString('utf8'))
}

function readKeychain(service: string, account: string): string | null {
  if (process.platform !== 'darwin') return null
  for (const args of [
    ['find-generic-password', '-s', service, '-a', account, '-w'],
    ['find-generic-password', '-s', service, '-w'],
  ]) {
    try {
      const value = execFileSync('security', args, { encoding: 'utf8' }).trim()
      if (value) return value
    } catch {
      // item missing for these args; try next candidate
    }
  }
  return null
}

/**
 * The first store of a credential domain whose data `accept` takes, in the
 * CLI's own order: keychain services, then `.credentials.json`.
 */
export function findClaudeCredentialStore(credentialDir: string | null, accept: (data: ClaudeCredentialData) => boolean): ClaudeCredentialStore | null {
  const account = userInfo().username
  for (const service of keychainServiceNames(credentialDir)) {
    const data = parseCredentialJson(readKeychain(service, account))
    if (data && accept(data)) return { source: 'keychain', serviceName: service, account, data }
  }
  const file = claudeCredentialsPath(credentialDir)
  if (!existsSync(file)) return null
  try {
    const data = parseCredentialJson(readFileSync(file, 'utf8'))
    if (data && accept(data)) return { source: 'file', serviceName: null, account: null, data }
  } catch (e) {
    log.warn('[claude-credentials] credentials file read failed: %s', String(e))
  }
  return null
}
