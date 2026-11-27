import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  ANTIGRAVITY_AUTH_METHODS,
  ANTIGRAVITY_CLI_ACCOUNT_ID,
  antigravityAccountProviderId,
  type AntigravityAccountSummary,
  type AntigravityAuthMethod,
} from '@superone/shared/antigravity-auth'
import { decryptSecret, encryptSecretIfAvailable } from '../crypto/secret-store'
import {
  candidateTokenPathsForAccount,
  hasValidTokenFile,
  listManagedAntigravityProfileDirs,
  readEmailFromTokenFile,
  resolveAntigravityAccountProfileDir,
  resolveAntigravityAccountsDir,
  resolveAntigravityAccountsIndexPath,
  resolveAntigravityBrainRoots,
  resolveAntigravityProfileDir,
  resolveAntigravityRoot,
  resolveLegacyAntigravityAuthConfigPath,
} from './antigravity-account-paths'

export {
  listManagedAntigravityProfileDirs,
  resolveAntigravityAccountProfileDir,
  resolveAntigravityAccountsDir,
  resolveAntigravityAccountsIndexPath,
  resolveAntigravityBrainRoots,
  resolveAntigravityProfileDir,
  resolveAntigravityRoot,
  resolveLegacyAntigravityAuthConfigPath,
}

const GCP_PROJECT_PATTERN = /^[a-z][a-z0-9.:-]{4,61}[a-z0-9]$/i
const GCP_LOCATION_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/i

export interface StoredAntigravityAccountRecord {
  id: string
  label?: string
  authMethod: AntigravityAuthMethod
  encryptedApiKey?: string
  gcpProject?: string
  gcpLocation?: string
  email?: string
  oauthSignedIn?: boolean
  createdAt: number
}

interface AntigravityAccountsIndex {
  version: 1
  defaultAccountId: string
  accounts: Record<string, StoredAntigravityAccountRecord>
}

export interface ResolvedAntigravityAccount {
  id: string
  label?: string
  authMethod: AntigravityAuthMethod
  isCliDefault: boolean
  isDefault: boolean
  profileDir: string | null
  apiKey?: string
  hasApiKey: boolean
  gcpProject?: string
  gcpLocation?: string
  email?: string
  oauthSignedIn?: boolean
}

function isValidAuthMethod(value: unknown): value is AntigravityAuthMethod {
  return typeof value === 'string' && (ANTIGRAVITY_AUTH_METHODS as readonly string[]).includes(value)
}

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function defaultCliAccountRecord(): StoredAntigravityAccountRecord {
  return {
    id: ANTIGRAVITY_CLI_ACCOUNT_ID,
    authMethod: 'oauth-personal',
    createdAt: 0,
  }
}

function defaultIndex(customHome?: string): AntigravityAccountsIndex {
  const cli = defaultCliAccountRecord()
  const legacyPath = resolveLegacyAntigravityAuthConfigPath(customHome)
  if (existsSync(legacyPath)) {
    try {
      const raw = JSON.parse(readFileSync(legacyPath, 'utf8')) as Record<string, unknown>
      if (isValidAuthMethod(raw.authMethod)) cli.authMethod = raw.authMethod
      const gcpProject = trimNonEmpty(raw.gcpProject)
      const gcpLocation = trimNonEmpty(raw.gcpLocation)
      const email = trimNonEmpty(raw.email)
      if (gcpProject) cli.gcpProject = gcpProject
      if (gcpLocation) cli.gcpLocation = gcpLocation
      if (email) cli.email = email
      if (typeof raw.oauthSignedIn === 'boolean') cli.oauthSignedIn = raw.oauthSignedIn
      if (typeof raw.encryptedApiKey === 'string' && raw.encryptedApiKey) {
        cli.encryptedApiKey = raw.encryptedApiKey
      }
    } catch {
      void 0
    }
  }
  return {
    version: 1,
    defaultAccountId: ANTIGRAVITY_CLI_ACCOUNT_ID,
    accounts: { [ANTIGRAVITY_CLI_ACCOUNT_ID]: cli },
  }
}

function readAccountsIndex(customHome?: string): AntigravityAccountsIndex {
  const path = resolveAntigravityAccountsIndexPath(customHome)
  if (!existsSync(path)) return defaultIndex(customHome)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AntigravityAccountsIndex>
    if (raw.version !== 1 || !raw.accounts || typeof raw.accounts !== 'object') {
      return defaultIndex(customHome)
    }
    const accounts: Record<string, StoredAntigravityAccountRecord> = {}
    for (const [id, entry] of Object.entries(raw.accounts)) {
      if (!entry || typeof entry !== 'object') continue
      accounts[id] = {
        id,
        authMethod: isValidAuthMethod(entry.authMethod) ? entry.authMethod : 'oauth-personal',
        ...(trimNonEmpty(entry.label) ? { label: trimNonEmpty(entry.label) } : {}),
        ...(trimNonEmpty(entry.gcpProject) ? { gcpProject: trimNonEmpty(entry.gcpProject) } : {}),
        ...(trimNonEmpty(entry.gcpLocation) ? { gcpLocation: trimNonEmpty(entry.gcpLocation) } : {}),
        ...(trimNonEmpty(entry.email) ? { email: trimNonEmpty(entry.email) } : {}),
        ...(typeof entry.oauthSignedIn === 'boolean' ? { oauthSignedIn: entry.oauthSignedIn } : {}),
        ...(typeof entry.encryptedApiKey === 'string' && entry.encryptedApiKey
          ? { encryptedApiKey: entry.encryptedApiKey }
          : {}),
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
      }
    }
    if (!accounts[ANTIGRAVITY_CLI_ACCOUNT_ID]) {
      accounts[ANTIGRAVITY_CLI_ACCOUNT_ID] = defaultCliAccountRecord()
    }
    const defaultAccountId =
      typeof raw.defaultAccountId === 'string' && accounts[raw.defaultAccountId]
        ? raw.defaultAccountId
        : ANTIGRAVITY_CLI_ACCOUNT_ID
    return { version: 1, defaultAccountId, accounts }
  } catch {
    return defaultIndex(customHome)
  }
}

function writeAccountsIndex(index: AntigravityAccountsIndex, customHome?: string): void {
  const root = resolveAntigravityRoot(customHome)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const target = resolveAntigravityAccountsIndexPath(customHome)
  const temp = join(root, `accounts-${randomUUID()}.tmp`)
  writeFileSync(temp, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(temp, 0o600)
  renameSync(temp, target)
}

function resolveAccountRecord(
  record: StoredAntigravityAccountRecord,
  defaultAccountId: string,
  customHome?: string,
): ResolvedAntigravityAccount {
  const decrypted = record.encryptedApiKey ? decryptSecret(record.encryptedApiKey).trim() : ''
  const envFallback =
    record.id === ANTIGRAVITY_CLI_ACCOUNT_ID
      ? trimNonEmpty(process.env.SUPERONE_ANTIGRAVITY_API_KEY)
      : undefined
  const apiKey = decrypted || envFallback
  let email = record.email
  if (!email) {
    for (const tokenPath of candidateTokenPathsForAccount(record.id, customHome)) {
      const found = readEmailFromTokenFile(tokenPath)
      if (found) {
        email = found
        break
      }
    }
  }
  return {
    id: record.id,
    ...(record.label ? { label: record.label } : {}),
    authMethod: record.authMethod,
    isCliDefault: record.id === ANTIGRAVITY_CLI_ACCOUNT_ID,
    isDefault: record.id === defaultAccountId,
    profileDir: resolveAntigravityAccountProfileDir(record.id, customHome),
    ...(apiKey ? { apiKey } : {}),
    hasApiKey: Boolean(apiKey),
    ...(record.gcpProject ? { gcpProject: record.gcpProject } : {}),
    ...(record.gcpLocation ? { gcpLocation: record.gcpLocation } : {}),
    ...(email ? { email } : {}),
    ...(record.oauthSignedIn !== undefined ? { oauthSignedIn: record.oauthSignedIn } : {}),
  }
}

export function isAccountAuthSatisfied(
  account: ResolvedAntigravityAccount,
  customHome?: string,
): boolean {
  switch (account.authMethod) {
    case 'gemini-api-key':
      return Boolean(account.apiKey)
    case 'agent-platform':
      return Boolean(account.apiKey || (account.gcpProject && account.gcpLocation))
    case 'oauth-business':
      return Boolean(
        account.gcpProject &&
          account.gcpLocation &&
          (account.oauthSignedIn === true ||
            candidateTokenPathsForAccount(account.id, customHome).some((p) => hasValidTokenFile(p))),
      )
    case 'oauth-personal':
      return (
        account.oauthSignedIn === true ||
        candidateTokenPathsForAccount(account.id, customHome).some((p) => hasValidTokenFile(p))
      )
  }
}

function validateGcpFields(gcpProject?: string, gcpLocation?: string): void {
  if (gcpProject && !GCP_PROJECT_PATTERN.test(gcpProject)) {
    throw new Error('Enter a valid Google Cloud project ID')
  }
  if (gcpLocation && !GCP_LOCATION_PATTERN.test(gcpLocation)) {
    throw new Error('Enter a valid Google Cloud location (for example us-central1 or global)')
  }
}

export class AntigravityAccountStore {
  constructor(readonly customHome?: string) {}

  list(): AntigravityAccountSummary[] {
    const index = readAccountsIndex(this.customHome)
    const records = Object.values(index.accounts).sort((a, b) => {
      if (a.id === ANTIGRAVITY_CLI_ACCOUNT_ID) return -1
      if (b.id === ANTIGRAVITY_CLI_ACCOUNT_ID) return 1
      return a.createdAt - b.createdAt
    })
    return records.map((record) => {
      const resolved = resolveAccountRecord(record, index.defaultAccountId, this.customHome)
      return {
        id: resolved.id,
        ...(resolved.label ? { label: resolved.label } : {}),
        authMethod: resolved.authMethod,
        signedIn: isAccountAuthSatisfied(resolved, this.customHome),
        isDefault: resolved.isDefault,
        isCliDefault: resolved.isCliDefault,
        ...(resolved.email ? { email: resolved.email } : {}),
        hasApiKey: resolved.hasApiKey,
        ...(resolved.gcpProject ? { gcpProject: resolved.gcpProject } : {}),
        ...(resolved.gcpLocation ? { gcpLocation: resolved.gcpLocation } : {}),
      }
    })
  }

  defaultAccountId(): string {
    return readAccountsIndex(this.customHome).defaultAccountId
  }

  defaultProviderId(): string | null {
    const index = readAccountsIndex(this.customHome)
    if (
      Object.keys(index.accounts).length <= 1 &&
      index.defaultAccountId === ANTIGRAVITY_CLI_ACCOUNT_ID
    ) {
      return null
    }
    return antigravityAccountProviderId(index.defaultAccountId)
  }

  get(accountId?: string | null): ResolvedAntigravityAccount {
    const index = readAccountsIndex(this.customHome)
    const targetId = accountId && index.accounts[accountId] ? accountId : index.defaultAccountId
    const record = index.accounts[targetId] ?? defaultCliAccountRecord()
    return resolveAccountRecord(record, index.defaultAccountId, this.customHome)
  }

  has(accountId: string): boolean {
    return Boolean(readAccountsIndex(this.customHome).accounts[accountId])
  }

  create(input: {
    label?: string
    authMethod: AntigravityAuthMethod
    apiKey?: string
    gcpProject?: string
    gcpLocation?: string
  }): ResolvedAntigravityAccount {
    if (!isValidAuthMethod(input.authMethod)) {
      throw new Error(`Unsupported Antigravity authentication method: ${String(input.authMethod)}`)
    }
    const gcpProject = trimNonEmpty(input.gcpProject)
    const gcpLocation = trimNonEmpty(input.gcpLocation)
    validateGcpFields(gcpProject, gcpLocation)

    const id = randomUUID()
    const index = readAccountsIndex(this.customHome)
    const apiKey = trimNonEmpty(input.apiKey)
    const record: StoredAntigravityAccountRecord = {
      id,
      ...(trimNonEmpty(input.label) ? { label: trimNonEmpty(input.label) } : {}),
      authMethod: input.authMethod,
      ...(gcpProject ? { gcpProject } : {}),
      ...(gcpLocation ? { gcpLocation } : {}),
      ...(apiKey ? { encryptedApiKey: encryptSecretIfAvailable(apiKey) } : {}),
      createdAt: Date.now(),
    }
    index.accounts[id] = record
    writeAccountsIndex(index, this.customHome)
    const profileDir = resolveAntigravityAccountProfileDir(id, this.customHome)
    if (profileDir) {
      mkdirSync(profileDir, { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32') chmodSync(profileDir, 0o700)
    }
    return resolveAccountRecord(record, index.defaultAccountId, this.customHome)
  }

  configure(input: {
    accountId: string
    label?: string
    authMethod: AntigravityAuthMethod
    apiKey?: string
    clearApiKey?: boolean
    gcpProject?: string
    gcpLocation?: string
    email?: string
    clearEmail?: boolean
    oauthSignedIn?: boolean
  }): ResolvedAntigravityAccount {
    if (!isValidAuthMethod(input.authMethod)) {
      throw new Error(`Unsupported Antigravity authentication method: ${String(input.authMethod)}`)
    }
    const index = readAccountsIndex(this.customHome)
    const prev = index.accounts[input.accountId]
    if (!prev) throw new Error(`Unknown Antigravity account: ${input.accountId}`)
    const gcpProject =
      input.gcpProject !== undefined ? trimNonEmpty(input.gcpProject) : prev.gcpProject
    const gcpLocation =
      input.gcpLocation !== undefined ? trimNonEmpty(input.gcpLocation) : prev.gcpLocation
    validateGcpFields(gcpProject, gcpLocation)

    const prevApiKey = prev.encryptedApiKey ? decryptSecret(prev.encryptedApiKey).trim() : undefined
    const nextApiKey = input.clearApiKey ? undefined : (trimNonEmpty(input.apiKey) ?? prevApiKey)
    const nextLabel = input.label !== undefined ? trimNonEmpty(input.label) : prev.label
    const nextEmail = input.clearEmail ? undefined : (trimNonEmpty(input.email) ?? prev.email)
    const nextSignedIn =
      input.oauthSignedIn !== undefined ? input.oauthSignedIn : prev.oauthSignedIn

    const updated: StoredAntigravityAccountRecord = {
      id: prev.id,
      authMethod: input.authMethod,
      ...(nextLabel ? { label: nextLabel } : {}),
      ...(gcpProject ? { gcpProject } : {}),
      ...(gcpLocation ? { gcpLocation } : {}),
      ...(nextEmail ? { email: nextEmail } : {}),
      ...(nextSignedIn !== undefined ? { oauthSignedIn: nextSignedIn } : {}),
      ...(nextApiKey ? { encryptedApiKey: encryptSecretIfAvailable(nextApiKey) } : {}),
      createdAt: prev.createdAt,
    }
    index.accounts[prev.id] = updated
    writeAccountsIndex(index, this.customHome)
    return resolveAccountRecord(updated, index.defaultAccountId, this.customHome)
  }

  setDefault(accountId: string): void {
    const index = readAccountsIndex(this.customHome)
    if (!index.accounts[accountId]) throw new Error(`Unknown Antigravity account: ${accountId}`)
    index.defaultAccountId = accountId
    writeAccountsIndex(index, this.customHome)
  }

  clearOAuthCredentials(accountId: string): void {
    for (const tokenPath of candidateTokenPathsForAccount(accountId, this.customHome)) {
      if (
        accountId === ANTIGRAVITY_CLI_ACCOUNT_ID &&
        !tokenPath.startsWith(resolveAntigravityRoot(this.customHome))
      ) {
        continue
      }
      try {
        rmSync(tokenPath, { force: true })
      } catch {
        void 0
      }
    }
    const index = readAccountsIndex(this.customHome)
    const prev = index.accounts[accountId]
    if (prev && (prev.email || prev.oauthSignedIn)) {
      this.configure({
        accountId,
        authMethod: prev.authMethod,
        clearEmail: true,
        oauthSignedIn: false,
      })
    }
  }

  remove(accountId: string): void {
    if (accountId === ANTIGRAVITY_CLI_ACCOUNT_ID) {
      throw new Error('Cannot remove the default CLI Antigravity account')
    }
    const index = readAccountsIndex(this.customHome)
    delete index.accounts[accountId]
    if (index.defaultAccountId === accountId) {
      index.defaultAccountId = ANTIGRAVITY_CLI_ACCOUNT_ID
    }
    writeAccountsIndex(index, this.customHome)
    const profileDir = resolveAntigravityAccountProfileDir(accountId, this.customHome)
    if (profileDir) {
      const rootDir = resolve(resolveAntigravityAccountsDir(this.customHome))
      const targetDir = resolve(profileDir)
      if (dirname(targetDir) === rootDir && existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true })
      }
    }
  }
}

export function antigravityAccountStore(customHome?: string): AntigravityAccountStore {
  return new AntigravityAccountStore(customHome)
}

export function isAntigravityAuthSatisfied(customHome?: string, accountId?: string | null): boolean {
  const store = antigravityAccountStore(customHome)
  return isAccountAuthSatisfied(store.get(accountId), customHome)
}
