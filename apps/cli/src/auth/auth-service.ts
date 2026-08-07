import type { AuthScope } from '@superone/shared/environment'
import { ADMIN_PAIRING_SCOPES, AUTH_CREDENTIAL_LIFETIMES } from '@superone/shared/environment'
import type { NodeDatabase } from '../db/database'
import type { NodeIdentity } from '../identity'
import {
  createSignedToken,
  fingerprintPublicKeyPem,
  hmacSha256Hex,
  randomToken,
  safeEqualString,
  sha256Hex,
  verifySignedToken,
} from '../crypto-util'

export interface PairingTokenRecord {
  tokenId: string
  /** Plaintext token — only returned once at creation; never logged. */
  token: string
  scopes: AuthScope[]
  expiresAt: number
}

export interface PairExchangeResult {
  clientSessionId: string
  refreshToken: string
  scopes: AuthScope[]
  environmentId: string
  nodePublicKeyFingerprint: string
  expiresAt: number
}

export interface AccessTokenResult {
  accessToken: string
  expiresAt: number
  scopes: AuthScope[]
  clientSessionId: string
}

export interface WsTicketResult {
  ticket: string
  expiresAt: number
}

export interface AuthenticatedClient {
  clientSessionId: string
  scopes: AuthScope[]
  devicePublicKeyFingerprint: string
  devicePublicKeyPem: string
}

function parseScopes(json: string): AuthScope[] {
  return JSON.parse(json) as AuthScope[]
}

/**
 * Node-side auth: pairing tokens, refresh families, access tokens, WS tickets.
 * Stores only keyed hashes for secrets; signs access/tickets with instance key.
 */
export class AuthService {
  private readonly hashKey: Buffer
  /** Called when a client session is revoked so the server can close sockets. */
  onRevoke: ((clientSessionId: string) => void) | null = null

  constructor(
    private readonly db: NodeDatabase,
    private readonly identity: NodeIdentity,
  ) {
    // Derive a keyed-hash secret from the instance private key material (stable per identity).
    this.hashKey = Buffer.from(sha256Hex(identity.privateKeyPem), 'hex')
  }

  isRevoked(clientSessionId: string): boolean {
    const row = this.db
      .prepare(`SELECT revoked_at FROM client_sessions WHERE client_session_id = ?`)
      .get(clientSessionId) as { revoked_at: number | null } | undefined
    if (!row) return true
    return row.revoked_at != null
  }

  private hashSecret(secret: string): string {
    return hmacSha256Hex(this.hashKey, secret)
  }

  createPairingToken(opts?: { scopes?: readonly AuthScope[]; ttlMs?: number }): PairingTokenRecord {
    const tokenId = crypto.randomUUID()
    const token = randomToken(32)
    const scopes = [...(opts?.scopes ?? ADMIN_PAIRING_SCOPES)] as AuthScope[]
    const now = Date.now()
    const expiresAt = now + (opts?.ttlMs ?? AUTH_CREDENTIAL_LIFETIMES.pairingTokenMs)

    this.db
      .prepare(
        `INSERT INTO pairing_tokens
         (token_id, token_hash, scopes_json, issuer, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(tokenId, this.hashSecret(token), JSON.stringify(scopes), this.identity.environmentId, expiresAt, now)

    return { tokenId, token, scopes, expiresAt }
  }

  /**
   * Atomically consume a pairing token and register the client device key.
   * Returns a refresh credential bound to that device.
   */
  exchangePairingToken(input: {
    pairingToken: string
    devicePublicKeyPem: string
    label?: string
  }): PairExchangeResult {
    const tokenHash = this.hashSecret(input.pairingToken)
    const now = Date.now()

    const exchange = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT token_id, scopes_json, expires_at, consumed_at, revoked_at
           FROM pairing_tokens WHERE token_hash = ?`,
        )
        .get(tokenHash) as
        | {
            token_id: string
            scopes_json: string
            expires_at: number
            consumed_at: number | null
            revoked_at: number | null
          }
        | undefined

      if (!row) throw Object.assign(new Error('invalid pairing token'), { code: 'unauthorized' })
      if (row.revoked_at) throw Object.assign(new Error('pairing token revoked'), { code: 'unauthorized' })
      if (row.consumed_at) throw Object.assign(new Error('pairing token already used'), { code: 'unauthorized' })
      if (row.expires_at < now) throw Object.assign(new Error('pairing token expired'), { code: 'unauthorized' })

      const updated = this.db
        .prepare(
          `UPDATE pairing_tokens SET consumed_at = ?
           WHERE token_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at >= ?`,
        )
        .run(now, row.token_id, now)
      if (updated.changes !== 1) {
        throw Object.assign(new Error('pairing token already used'), { code: 'unauthorized' })
      }

      const clientSessionId = crypto.randomUUID()
      const refreshToken = randomToken(32)
      const refreshFamilyId = crypto.randomUUID()
      const scopes = parseScopes(row.scopes_json)
      const deviceFp = fingerprintPublicKeyPem(input.devicePublicKeyPem)
      const refreshExpiresAt = now + AUTH_CREDENTIAL_LIFETIMES.refreshInactivityMs

      this.db
        .prepare(
          `INSERT INTO client_sessions
           (client_session_id, device_public_key_pem, device_public_key_fingerprint, label,
            scopes_json, refresh_family_id, refresh_hash, refresh_expires_at, created_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          clientSessionId,
          input.devicePublicKeyPem,
          deviceFp,
          input.label ?? null,
          JSON.stringify(scopes),
          refreshFamilyId,
          this.hashSecret(refreshToken),
          refreshExpiresAt,
          now,
          now,
        )

      return {
        clientSessionId,
        refreshToken,
        scopes,
        environmentId: this.identity.environmentId,
        nodePublicKeyFingerprint: this.identity.publicKeyFingerprint,
        expiresAt: refreshExpiresAt,
      } satisfies PairExchangeResult
    })

    return exchange()
  }

  /**
   * Rotate refresh credential.
   *
   * Reuse of a rotated refresh hash outside
   * {@link AUTH_CREDENTIAL_LIFETIMES.refreshReuseGraceMs} is treated as theft
   * and permanently revokes the family. Inside the grace window, presenting any
   * previously rotated hash re-rotates the *current* session and returns a fresh
   * pair (lost-response / concurrent-refresh races — RFC 6819 §5.2.2.3 style).
   *
   * Requires proof signature over `proofPayload` with the registered device key.
   */
  refreshAccess(input: {
    refreshToken: string
    /** Proof-of-possession: client signs this exact string with device private key. */
    proofPayload: string
    proofSignature: string
    verifyDeviceProof: (publicKeyPem: string, payload: string, signature: string) => boolean
  }): AccessTokenResult & { refreshToken: string } {
    const refreshHash = this.hashSecret(input.refreshToken)
    const now = Date.now()

    type SessionRow = {
      client_session_id: string
      device_public_key_pem: string
      device_public_key_fingerprint: string
      scopes_json: string
      refresh_family_id: string
      refresh_hash: string
      refresh_expires_at: number
      revoked_at: number | null
    }

    const loadByHash = (hash: string): SessionRow | undefined =>
      this.db
        .prepare(
          `SELECT client_session_id, device_public_key_pem, device_public_key_fingerprint,
                  scopes_json, refresh_family_id, refresh_hash, refresh_expires_at, revoked_at
           FROM client_sessions WHERE refresh_hash = ?`,
        )
        .get(hash) as SessionRow | undefined

    const loadBySessionId = (clientSessionId: string): SessionRow | undefined =>
      this.db
        .prepare(
          `SELECT client_session_id, device_public_key_pem, device_public_key_fingerprint,
                  scopes_json, refresh_family_id, refresh_hash, refresh_expires_at, revoked_at
           FROM client_sessions WHERE client_session_id = ?`,
        )
        .get(clientSessionId) as SessionRow | undefined

    let row = loadByHash(refreshHash)

    if (!row) {
      // Rotated-away token: within grace → re-rotate current session (lost response /
      // concurrent retries). Outside grace → permanent family revoke (theft signal).
      // Any generation still inside its own grace window is accepted so two in-flight
      // retries of the same previous hash do not cascade into revoke.
      const reused = this.db
        .prepare(
          `SELECT client_session_id, seen_at FROM refresh_reuse_log WHERE refresh_hash = ?`,
        )
        .get(refreshHash) as { client_session_id: string; seen_at: number } | undefined

      if (!reused) {
        throw Object.assign(new Error('invalid refresh token'), { code: 'unauthorized' })
      }

      const withinGrace =
        now - reused.seen_at <= AUTH_CREDENTIAL_LIFETIMES.refreshReuseGraceMs

      if (withinGrace) {
        row = loadBySessionId(reused.client_session_id)
        if (!row) {
          throw Object.assign(new Error('invalid refresh token'), { code: 'unauthorized' })
        }
      } else {
        this.db
          .prepare(
            'UPDATE client_sessions SET revoked_at = ? WHERE client_session_id = ? AND revoked_at IS NULL',
          )
          .run(now, reused.client_session_id)
        this.onRevoke?.(reused.client_session_id)
        throw Object.assign(new Error('refresh token reuse detected; session revoked'), {
          code: 'unauthorized',
        })
      }
    }

    if (row.revoked_at) throw Object.assign(new Error('client session revoked'), { code: 'unauthorized' })
    if (row.refresh_expires_at < now) {
      throw Object.assign(new Error('refresh token expired'), { code: 'unauthorized' })
    }

    if (!input.verifyDeviceProof(row.device_public_key_pem, input.proofPayload, input.proofSignature)) {
      throw Object.assign(new Error('device proof failed'), { code: 'unauthorized' })
    }
    // Canonical proof: `refresh:<clientSessionId>:<unixMs>` with 2-minute freshness window.
    const m = /^refresh:([^:]+):(\d+)$/.exec(input.proofPayload)
    if (!m) {
      throw Object.assign(new Error('proof payload must be refresh:<clientSessionId>:<unixMs>'), {
        code: 'unauthorized',
      })
    }
    if (m[1] !== row.client_session_id) {
      throw Object.assign(new Error('proof clientSessionId mismatch'), { code: 'unauthorized' })
    }
    const proofTs = Number(m[2])
    if (!Number.isFinite(proofTs) || Math.abs(now - proofTs) > 120_000) {
      throw Object.assign(new Error('proof timestamp out of window'), { code: 'unauthorized' })
    }

    // Capture for the transaction closure (row is definitely defined here).
    const session = row

    return this.db.transaction(() => {
      const scopes = parseScopes(session.scopes_json)
      const newRefresh = randomToken(32)
      const newRefreshHash = this.hashSecret(newRefresh)
      const refreshExpiresAt = now + AUTH_CREDENTIAL_LIFETIMES.refreshInactivityMs

      // Record current hash so later reuse of this generation is detected.
      this.db
        .prepare(
          `INSERT OR IGNORE INTO refresh_reuse_log (refresh_hash, client_session_id, seen_at)
           VALUES (?, ?, ?)`,
        )
        .run(session.refresh_hash, session.client_session_id, now)

      const updated = this.db
        .prepare(
          `UPDATE client_sessions
           SET refresh_hash = ?, refresh_expires_at = ?, last_used_at = ?
           WHERE client_session_id = ? AND refresh_hash = ? AND revoked_at IS NULL`,
        )
        .run(newRefreshHash, refreshExpiresAt, now, session.client_session_id, session.refresh_hash)
      if (updated.changes !== 1) {
        throw Object.assign(new Error('refresh race; retry'), { code: 'conflict' })
      }

      const expiresAt = now + AUTH_CREDENTIAL_LIFETIMES.accessTokenMs
      const accessToken = createSignedToken(this.identity.privateKeyPem, {
        iss: this.identity.environmentId,
        aud: 'superone',
        exp: expiresAt,
        iat: now,
        clientSessionId: session.client_session_id,
        scopes,
        proofKeyThumbprint: session.device_public_key_fingerprint,
      })

      return {
        accessToken,
        expiresAt,
        scopes,
        clientSessionId: session.client_session_id,
        refreshToken: newRefresh,
      }
    })()
  }

  /** Mint a short-lived single-use WebSocket ticket from a valid access token. */
  createWsTicket(accessToken: string): WsTicketResult {
    const verified = this.verifyAccessToken(accessToken)
    if (!verified.ok) {
      throw Object.assign(new Error(verified.reason), { code: 'unauthorized' })
    }
    const client = verified.client
    const now = Date.now()
    const expiresAt = now + AUTH_CREDENTIAL_LIFETIMES.wsTicketMs
    const ticketId = crypto.randomUUID()
    const ticket = randomToken(24)
    const ticketHash = this.hashSecret(ticket)

    this.db
      .prepare(
        `INSERT INTO ws_tickets
         (ticket_id, ticket_hash, client_session_id, scopes_json, proof_thumbprint, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ticketId,
        ticketHash,
        client.clientSessionId,
        JSON.stringify(client.scopes),
        client.devicePublicKeyFingerprint,
        expiresAt,
        now,
      )

    // Return opaque ticket; wire also accepts signed form for debugging.
    return { ticket: `${ticketId}.${ticket}`, expiresAt }
  }

  /**
   * Look up a ticket without consuming it. Used to verify PoP before consume.
   */
  peekWsTicket(ticket: string): AuthenticatedClient & { ticketId: string } {
    const parts = ticket.split('.')
    if (parts.length !== 2) {
      throw Object.assign(new Error('malformed ws ticket'), { code: 'unauthorized' })
    }
    const [ticketId, secret] = parts
    if (!ticketId || !secret) {
      throw Object.assign(new Error('malformed ws ticket'), { code: 'unauthorized' })
    }
    const ticketHash = this.hashSecret(secret)
    const now = Date.now()
    const row = this.db
      .prepare(
        `SELECT t.ticket_id, t.ticket_hash, t.client_session_id, t.scopes_json, t.proof_thumbprint,
                t.expires_at, t.consumed_at, s.device_public_key_pem, s.revoked_at
         FROM ws_tickets t
         JOIN client_sessions s ON s.client_session_id = t.client_session_id
         WHERE t.ticket_id = ?`,
      )
      .get(ticketId) as
      | {
          ticket_id: string
          ticket_hash: string
          client_session_id: string
          scopes_json: string
          proof_thumbprint: string
          expires_at: number
          consumed_at: number | null
          device_public_key_pem: string
          revoked_at: number | null
        }
      | undefined

    if (!row) throw Object.assign(new Error('invalid ws ticket'), { code: 'unauthorized' })
    if (row.revoked_at) throw Object.assign(new Error('client session revoked'), { code: 'unauthorized' })
    if (row.consumed_at) throw Object.assign(new Error('ws ticket already used'), { code: 'unauthorized' })
    if (row.expires_at < now) throw Object.assign(new Error('ws ticket expired'), { code: 'unauthorized' })
    if (!safeEqualString(row.ticket_hash, ticketHash)) {
      throw Object.assign(new Error('invalid ws ticket'), { code: 'unauthorized' })
    }
    return {
      ticketId: row.ticket_id,
      clientSessionId: row.client_session_id,
      scopes: parseScopes(row.scopes_json),
      devicePublicKeyFingerprint: row.proof_thumbprint,
      devicePublicKeyPem: row.device_public_key_pem,
    }
  }

  /**
   * Atomically consume a WS ticket after proof verification.
   * Invalid signatures must call peek only — never this — so tickets are not burned.
   */
  consumeWsTicket(ticket: string): AuthenticatedClient {
    const peeked = this.peekWsTicket(ticket)
    const now = Date.now()

    return this.db.transaction(() => {
      const updated = this.db
        .prepare(
          `UPDATE ws_tickets SET consumed_at = ?
           WHERE ticket_id = ? AND consumed_at IS NULL AND expires_at >= ?`,
        )
        .run(now, peeked.ticketId, now)
      if (updated.changes !== 1) {
        throw Object.assign(new Error('ws ticket already used'), { code: 'unauthorized' })
      }

      this.db
        .prepare('UPDATE client_sessions SET last_used_at = ? WHERE client_session_id = ?')
        .run(now, peeked.clientSessionId)

      return {
        clientSessionId: peeked.clientSessionId,
        scopes: peeked.scopes,
        devicePublicKeyFingerprint: peeked.devicePublicKeyFingerprint,
        devicePublicKeyPem: peeked.devicePublicKeyPem,
      }
    })()
  }

  verifyAccessToken(accessToken: string): { ok: true; client: AuthenticatedClient } | { ok: false; reason: string } {
    const verified = verifySignedToken(this.identity.publicKeyPem, accessToken)
    if (!verified.ok) return verified
    const claims = verified.claims
    const now = Date.now()
    if (claims.aud !== 'superone') return { ok: false, reason: 'invalid audience' }
    if (claims.iss !== this.identity.environmentId) return { ok: false, reason: 'invalid issuer' }
    if (typeof claims.exp !== 'number' || claims.exp < now) return { ok: false, reason: 'token expired' }
    if (typeof claims.clientSessionId !== 'string') return { ok: false, reason: 'missing client session' }

    const row = this.db
      .prepare(
        `SELECT client_session_id, device_public_key_pem, device_public_key_fingerprint, scopes_json, revoked_at
         FROM client_sessions WHERE client_session_id = ?`,
      )
      .get(claims.clientSessionId) as
      | {
          client_session_id: string
          device_public_key_pem: string
          device_public_key_fingerprint: string
          scopes_json: string
          revoked_at: number | null
        }
      | undefined

    if (!row) return { ok: false, reason: 'unknown client session' }
    if (row.revoked_at) return { ok: false, reason: 'client session revoked' }
    if (
      typeof claims.proofKeyThumbprint === 'string' &&
      claims.proofKeyThumbprint !== row.device_public_key_fingerprint
    ) {
      return { ok: false, reason: 'proof key mismatch' }
    }

    return {
      ok: true,
      client: {
        clientSessionId: row.client_session_id,
        scopes: parseScopes(row.scopes_json),
        devicePublicKeyFingerprint: row.device_public_key_fingerprint,
        devicePublicKeyPem: row.device_public_key_pem,
      },
    }
  }

  revokeClientSession(clientSessionId: string): boolean {
    const now = Date.now()
    const result = this.db
      .prepare('UPDATE client_sessions SET revoked_at = ? WHERE client_session_id = ? AND revoked_at IS NULL')
      .run(now, clientSessionId)
    if (result.changes === 1) {
      try {
        this.onRevoke?.(clientSessionId)
      } catch {
        /* best-effort socket close */
      }
      return true
    }
    return false
  }

  listClientSessions(): Array<{
    clientSessionId: string
    label: string | null
    devicePublicKeyFingerprint: string
    createdAt: number
    lastUsedAt: number
    revokedAt: number | null
  }> {
    return (
      this.db
        .prepare(
          `SELECT client_session_id, label, device_public_key_fingerprint, created_at, last_used_at, revoked_at
           FROM client_sessions ORDER BY created_at DESC`,
        )
        .all() as Array<{
        client_session_id: string
        label: string | null
        device_public_key_fingerprint: string
        created_at: number
        last_used_at: number
        revoked_at: number | null
      }>
    ).map((r) => ({
      clientSessionId: r.client_session_id,
      label: r.label,
      devicePublicKeyFingerprint: r.device_public_key_fingerprint,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
    }))
  }
}
