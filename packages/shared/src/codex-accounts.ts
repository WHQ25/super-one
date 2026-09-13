import type { CodexAccountStatus, CodexAccountLoginStartResult } from './agent-types'

export const CODEX_ACCOUNT_PREFIX = 'codex-account:'
/** The user's existing CLI login. It is never an alias for a mutable default. */
export const CODEX_CLI_ACCOUNT_ID = 'cli'

export interface CodexAccount extends CodexAccountStatus {
  id: string
  isDefault: boolean
  loginState?: 'pending' | 'failed'
  unavailable?: boolean
}

export type CodexManagedLoginStart = CodexAccountLoginStartResult & { accountId: string }

export function isCodexAccountProvider(id: string | null | undefined): boolean {
  return !!id?.startsWith(CODEX_ACCOUNT_PREFIX)
}

export function codexAccountProviderId(id: string): string {
  return `${CODEX_ACCOUNT_PREFIX}${id}`
}

export function codexAccountId(providerId: string | null | undefined): string | null {
  if (!isCodexAccountProvider(providerId)) return null
  const id = providerId!.slice(CODEX_ACCOUNT_PREFIX.length)
  if (id !== CODEX_CLI_ACCOUNT_ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid Codex account ID')
  }
  return id
}

export function assertCodexAccountSwitchAllowed(
  previous: string | null | undefined,
  next: string | null | undefined,
  hasHistory: boolean,
): void {
  if (!hasHistory || previous === next) return
  if (isCodexAccountProvider(previous) || isCodexAccountProvider(next)) {
    throw new Error('Start a new conversation to use a different Codex account.')
  }
}

export const CodexAccountIpcChannels = {
  LIST: 'codex:list-accounts',
  SET_DEFAULT: 'codex:set-default-account',
} as const
