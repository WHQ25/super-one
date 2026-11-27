export const ANTIGRAVITY_AUTH_METHODS = [
  'oauth-personal',
  'oauth-business',
  'gemini-api-key',
  'agent-platform',
] as const

export type AntigravityAuthMethod = (typeof ANTIGRAVITY_AUTH_METHODS)[number]

export const ANTIGRAVITY_ACCOUNT_PREFIX = 'antigravity-account:'
export const ANTIGRAVITY_CLI_ACCOUNT_ID = 'cli'

const ACCOUNT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isAntigravityAccountProvider(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(ANTIGRAVITY_ACCOUNT_PREFIX))
}

export function antigravityAccountProviderId(id: string): string {
  return `${ANTIGRAVITY_ACCOUNT_PREFIX}${id}`
}

export function antigravityAccountId(providerId: string | null | undefined): string | null {
  if (!isAntigravityAccountProvider(providerId)) return null
  const id = providerId!.slice(ANTIGRAVITY_ACCOUNT_PREFIX.length)
  if (id !== ANTIGRAVITY_CLI_ACCOUNT_ID && !ACCOUNT_UUID_RE.test(id)) {
    throw new Error('Invalid Antigravity account ID')
  }
  return id
}

export function assertAntigravityAccountSwitchAllowed(
  previous: string | null | undefined,
  next: string | null | undefined,
  hasHistory: boolean,
): void {
  if (!hasHistory || previous === next) return
  if (isAntigravityAccountProvider(previous) || isAntigravityAccountProvider(next)) {
    throw new Error('Start a new conversation to use a different Antigravity account.')
  }
}

export interface AntigravityAccountSummary {
  id: string
  label?: string
  authMethod: AntigravityAuthMethod
  signedIn: boolean
  isDefault: boolean
  isCliDefault: boolean
  email?: string
  hasApiKey: boolean
  gcpProject?: string
  gcpLocation?: string
}

export interface AntigravityActiveLogin {
  accountId: string
  loginId: string
  status: 'starting' | 'waiting' | 'verifying'
  authMethod: 'oauth-personal' | 'oauth-business'
  mode: 'code' | 'loopback'
  authUrl?: string
}

export interface AntigravityAccountsSnapshot {
  runtimeAvailable: boolean
  defaultAccountId: string
  accounts: AntigravityAccountSummary[]
  activeLogin?: AntigravityActiveLogin | null
  error?: string
}

export type AntigravityAuthRequest =
  | { action: 'list' }
  | { action: 'refresh' }
  | {
      action: 'create'
      label?: string
      authMethod: AntigravityAuthMethod
      apiKey?: string
      gcpProject?: string
      gcpLocation?: string
    }
  | {
      action: 'configure'
      accountId: string
      label?: string
      authMethod: AntigravityAuthMethod
      apiKey?: string
      clearApiKey?: boolean
      gcpProject?: string
      gcpLocation?: string
    }
  | { action: 'setDefault'; accountId: string }
  | { action: 'startLogin'; accountId: string; authMethod?: AntigravityAuthMethod }
  | { action: 'submitLoginResponse'; loginId: string; response: string }
  | { action: 'cancelLogin'; loginId: string }
  | { action: 'logout'; accountId: string }
  | { action: 'remove'; accountId: string }

export const ANTIGRAVITY_AUTH_CHANNEL = 'acp:antigravity-auth'
export const ANTIGRAVITY_AUTH_REQUIRED =
  'Antigravity authentication required. Open Settings → Harnesses → Antigravity to sign in or configure an account.'
