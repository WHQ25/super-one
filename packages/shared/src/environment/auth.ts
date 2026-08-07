/**
 * Node authentication and authorization contracts.
 * Pairing and steady-state credentials are distinct; secrets never live in
 * ordinary SQLite rows or renderer storage.
 */

/** Initial auth scopes (Section 12.2). */
export const AUTH_SCOPES = [
  'environment:read',
  'project:read',
  'project:manage',
  'session:read',
  'session:operate',
  'terminal:operate',
  'workspace:read',
  'workspace:write',
  'access:manage',
  'node:admin',
] as const

export type AuthScope = (typeof AUTH_SCOPES)[number]

export const ALL_AUTH_SCOPES: readonly AuthScope[] = AUTH_SCOPES

/** Administrative pairing grants every scope. */
export const ADMIN_PAIRING_SCOPES: readonly AuthScope[] = AUTH_SCOPES

export const AUTH_CREDENTIAL_LIFETIMES = {
  /** Pairing token: 10 minutes, single exchange. */
  pairingTokenMs: 10 * 60 * 1000,
  /** Access token: 15 minutes. */
  accessTokenMs: 15 * 60 * 1000,
  /** WebSocket ticket: 30 seconds, single /ws upgrade. */
  wsTicketMs: 30 * 1000,
  /** Refresh family expires after 90 days of inactivity. */
  refreshInactivityMs: 90 * 24 * 60 * 60 * 1000,
  /**
   * Immediately-previous refresh token remains redeemable this long after
   * rotation. Mitigates lost-response / concurrent-refresh races without
   * disabling reuse detection for older generations (RFC 6819 §5.2.2.3).
   */
  refreshReuseGraceMs: 60 * 1000,
} as const

export interface PairingTokenMetadata {
  tokenId: string
  scopes: AuthScope[]
  expiresAt: number
  issuer: string
}

export interface ClientSessionDescriptor {
  clientSessionId: string
  devicePublicKeyFingerprint: string
  scopes: AuthScope[]
  label?: string
  createdAt: number
  lastUsedAt: number
  revokedAt?: number
}

export interface AccessTokenClaims {
  iss: string
  aud: 'superone'
  exp: number
  iat: number
  clientSessionId: string
  scopes: AuthScope[]
  /** Device public-key thumbprint for proof-of-possession. */
  proofKeyThumbprint: string
}

export interface WsTicketClaims {
  iss: string
  aud: '/ws'
  exp: number
  iat: number
  clientSessionId: string
  scopes: AuthScope[]
  proofKeyThumbprint: string
}

export function hasScope(granted: readonly AuthScope[], required: AuthScope): boolean {
  return granted.includes(required)
}

export function hasAllScopes(granted: readonly AuthScope[], required: readonly AuthScope[]): boolean {
  return required.every((s) => granted.includes(s))
}

export function hasAnyScope(granted: readonly AuthScope[], candidates: readonly AuthScope[]): boolean {
  return candidates.some((s) => granted.includes(s))
}

/** Scopes required for common gateway operations. */
export const OPERATION_SCOPES = {
  readEnvironment: ['environment:read'] as const satisfies readonly AuthScope[],
  readProject: ['project:read'] as const satisfies readonly AuthScope[],
  manageProject: ['project:manage'] as const satisfies readonly AuthScope[],
  readSession: ['session:read'] as const satisfies readonly AuthScope[],
  operateSession: ['session:operate'] as const satisfies readonly AuthScope[],
  operateTerminal: ['terminal:operate'] as const satisfies readonly AuthScope[],
  readWorkspace: ['workspace:read'] as const satisfies readonly AuthScope[],
  writeWorkspace: ['workspace:write'] as const satisfies readonly AuthScope[],
  manageAccess: ['access:manage'] as const satisfies readonly AuthScope[],
  adminNode: ['node:admin'] as const satisfies readonly AuthScope[],
} as const
