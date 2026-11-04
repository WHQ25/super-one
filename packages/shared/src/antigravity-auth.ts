export const ANTIGRAVITY_AUTH_METHODS = [
  'oauth-personal',
  'oauth-business',
  'gemini-api-key',
  'agent-platform',
] as const

export type AntigravityAuthMethod = (typeof ANTIGRAVITY_AUTH_METHODS)[number]

export interface AntigravityAuthConfig {
  authMethod: AntigravityAuthMethod
  hasApiKey: boolean
  gcpProject?: string
  gcpLocation?: string
}

export interface AntigravityAuthState {
  status:
    | 'signed_out'
    | 'starting'
    | 'waiting'
    | 'verifying'
    | 'signed_in'
    | 'error'
    | 'unavailable'
  authMethod: AntigravityAuthMethod
  hasApiKey: boolean
  gcpProject?: string
  gcpLocation?: string
  config?: AntigravityAuthConfig
  loginId?: string
  authUrl?: string
  email?: string
  error?: string
}

export type AntigravityAuthRequest =
  | { action: 'status' }
  | { action: 'refresh' }
  | {
      action: 'configure'
      authMethod: AntigravityAuthMethod
      apiKey?: string
      clearApiKey?: boolean
      gcpProject?: string
      gcpLocation?: string
    }
  | { action: 'start'; authMethod?: AntigravityAuthMethod }
  | { action: 'submitCallback'; loginId: string; callbackUrl: string }
  | { action: 'cancel'; loginId: string }
  | { action: 'logout' }

export const ANTIGRAVITY_AUTH_CHANNEL = 'acp:antigravity-auth'
export const ANTIGRAVITY_AUTH_REQUIRED =
  'Antigravity authentication required. Open Settings → Harnesses → Antigravity to sign in or configure credentials.'
