/** Grok Build owns credentials; only public account/login state crosses IPC. */
export interface GrokAuthState {
  status: 'signed_out' | 'starting' | 'waiting' | 'verifying' | 'signed_in' | 'error' | 'unavailable'
  loginId?: string
  authUrl?: string
  mode?: string
  email?: string
  method?: string
  error?: string
}

export type GrokAuthRequest =
  | { action: 'status' }
  | { action: 'refresh' }
  | { action: 'start' }
  | { action: 'submit'; loginId: string; code: string }
  | { action: 'cancel'; loginId: string }

export const GROK_AUTH_CHANNEL = 'acp:grok-auth'
export const GROK_AUTH_REQUIRED = 'Grok authentication required. Open Settings → Harnesses → Grok → Account to sign in, or sign in with Grok Build and retry.'
