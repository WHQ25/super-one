/**
 * Cursor SDK interactive auth (SDK ≥1.0.25) — Node only.
 * Browser login mints a User API Key; SuperOne should store it in its vault.
 */

import { Cursor, type SdkAuthStatus, type SdkLoginOptions, type SdkLoginResult } from '@cursor/sdk'

export type CursorSdkLoginResult = {
  apiKey: string
  email?: string
  apiKeyExpiresAtMs: number
}

export type CursorSdkAuthStatus =
  | { status: 'logged-out' }
  | { status: 'logged-in'; backendUrl: string; email?: string; apiKeyExpiresAtMs?: number }

/**
 * Open browser (or custom opener) login and mint a User API Key.
 * Default store is SDK's `~/.cursor/sdk/auth.json`; SuperOne still copies the
 * key into its own secret store for harness config.
 */
export async function cursorSdkLogin(options?: {
  openBrowser?: boolean | ((url: string) => void | Promise<void>)
  onLoginUrl?: (url: string) => void
  signal?: AbortSignal
  apiKeyName?: string
  /** When true, do not write ~/.cursor/sdk/auth.json (only return the key). */
  skipSdkStore?: boolean
}): Promise<CursorSdkLoginResult> {
  const loginOpts: SdkLoginOptions = {
    openBrowser: options?.openBrowser,
    onLoginUrl: options?.onLoginUrl,
    signal: options?.signal,
    apiKeyName: options?.apiKeyName ?? 'SuperOne',
    ...(options?.skipSdkStore ? { store: null } : {}),
  }
  const result: SdkLoginResult = await Cursor.auth.login(loginOpts)
  return {
    apiKey: result.apiKey,
    email: result.email,
    apiKeyExpiresAtMs: result.apiKeyExpiresAtMs,
  }
}

/** Report whether a stored, unexpired SDK login exists (never returns the key). */
export async function cursorSdkAuthStatus(): Promise<CursorSdkAuthStatus> {
  const status: SdkAuthStatus = await Cursor.auth.status()
  if (status.status === 'logged-out') return { status: 'logged-out' }
  return {
    status: 'logged-in',
    backendUrl: status.backendUrl,
    email: status.email,
    apiKeyExpiresAtMs: status.apiKeyExpiresAtMs,
  }
}

/** Drop the SDK on-disk login store (key remains valid until expiry on Cursor side). */
export async function cursorSdkLogout(): Promise<void> {
  await Cursor.auth.logout()
}
