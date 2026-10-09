import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateEd25519KeyPair, signPayload, verifyPayload } from '../crypto-util'
import { openNodeDatabase } from '../db/database'
import { loadOrCreateIdentity } from '../identity'
import { AuthService } from './auth-service'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setup() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'superone-auth-'))
  dirs.push(nodeHome)
  const identity = loadOrCreateIdentity(nodeHome)
  const db = openNodeDatabase(join(nodeHome, 'state.sqlite'))
  const auth = new AuthService(db, identity)
  return { nodeHome, identity, db, auth }
}

describe('AuthService', () => {
  it('pairs once, refreshes with device proof, and issues a single-use ws ticket', () => {
    const { auth, identity } = setup()
    const device = generateEd25519KeyPair()

    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
      label: 'test-desktop',
    })
    expect(paired.environmentId).toBe(identity.environmentId)
    expect(paired.refreshToken.length).toBeGreaterThan(10)

    // Pairing token is single-use
    expect(() =>
      auth.exchangePairingToken({
        pairingToken: pairToken.token,
        devicePublicKeyPem: device.publicKeyPem,
      }),
    ).toThrow(/already used/)

    const proofPayload = `refresh:${paired.clientSessionId}:${Date.now()}`
    const proofSignature = signPayload(device.privateKeyPem, proofPayload)
    const access = auth.refreshAccess({
      refreshToken: paired.refreshToken,
      proofPayload,
      proofSignature,
      verifyDeviceProof: verifyPayload,
    })
    expect(access.accessToken.includes('.')).toBe(true)
    expect(access.refreshToken).not.toBe(paired.refreshToken)

    const ticket = auth.createWsTicket(access.accessToken)
    const client = auth.consumeWsTicket(ticket.ticket)
    expect(client.clientSessionId).toBe(paired.clientSessionId)

    expect(() => auth.consumeWsTicket(ticket.ticket)).toThrow(/already used/)
  })

  it('reports live pairing tokens and announces each new pairing', () => {
    const { auth } = setup()
    const paired: string[] = []
    auth.onPaired = (id) => paired.push(id)
    expect(auth.hasLivePairingToken()).toBe(false)
    const token = auth.createPairingToken()
    expect(auth.hasLivePairingToken()).toBe(true)
    expect(auth.hasLivePairingToken(token.expiresAt + 1)).toBe(false)
    const result = auth.exchangePairingToken({
      pairingToken: token.token,
      devicePublicKeyPem: generateEd25519KeyPair().publicKeyPem,
    })
    expect(paired).toEqual([result.clientSessionId])
    expect(auth.hasLivePairingToken()).toBe(false)
  })

  it('revokes session and rejects subsequent access tokens', () => {
    const { auth } = setup()
    const device = generateEd25519KeyPair()
    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
    })
    const proofPayload = `refresh:${paired.clientSessionId}:${Date.now()}`
    const access = auth.refreshAccess({
      refreshToken: paired.refreshToken,
      proofPayload,
      proofSignature: signPayload(device.privateKeyPem, proofPayload),
      verifyDeviceProof: verifyPayload,
    })

    expect(auth.revokeClientSession(paired.clientSessionId)).toBe(true)
    const verified = auth.verifyAccessToken(access.accessToken)
    expect(verified.ok).toBe(false)
  })

  it('createWsTicket after session revoke surfaces code revoked (not unauthorized)', () => {
    const { auth } = setup()
    const device = generateEd25519KeyPair()
    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
    })
    const proofPayload = `refresh:${paired.clientSessionId}:${Date.now()}`
    const access = auth.refreshAccess({
      refreshToken: paired.refreshToken,
      proofPayload,
      proofSignature: signPayload(device.privateKeyPem, proofPayload),
      verifyDeviceProof: verifyPayload,
    })

    expect(auth.revokeClientSession(paired.clientSessionId)).toBe(true)
    try {
      auth.createWsTicket(access.accessToken)
      expect.fail('expected createWsTicket to throw')
    } catch (err) {
      expect(err).toMatchObject({ code: 'revoked' })
      expect((err as Error).message).toMatch(/session revoked/i)
    }
  })

  it('refresh after explicit revoke surfaces code revoked', () => {
    const { auth } = setup()
    const device = generateEd25519KeyPair()
    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
    })
    expect(auth.revokeClientSession(paired.clientSessionId)).toBe(true)
    const proof = `refresh:${paired.clientSessionId}:${Date.now()}`
    try {
      auth.refreshAccess({
        refreshToken: paired.refreshToken,
        proofPayload: proof,
        proofSignature: signPayload(device.privateKeyPem, proof),
        verifyDeviceProof: verifyPayload,
      })
      expect.fail('expected refreshAccess to throw')
    } catch (err) {
      expect(err).toMatchObject({ code: 'revoked' })
    }
  })

  it('suspends a session as non-terminal unauthorized, closes it, and lets it back in', () => {
    const { auth } = setup()
    const device = generateEd25519KeyPair()
    const paired = auth.exchangePairingToken({
      pairingToken: auth.createPairingToken().token,
      devicePublicKeyPem: device.publicKeyPem,
    })
    const refresh = (refreshToken: string) => {
      const proof = `refresh:${paired.clientSessionId}:${Date.now()}`
      return auth.refreshAccess({
        refreshToken,
        proofPayload: proof,
        proofSignature: signPayload(device.privateKeyPem, proof),
        verifyDeviceProof: verifyPayload,
      })
    }
    const access = refresh(paired.refreshToken)
    const ticket = auth.createWsTicket(access.accessToken)
    const closed: string[] = []
    auth.onRevoke = (id) => closed.push(id)

    expect(auth.setClientSessionSuspended(paired.clientSessionId, true)).toBe(true)
    expect(closed).toEqual([paired.clientSessionId])
    expect(auth.listClientSessions()[0]?.suspendedAt).toEqual(expect.any(Number))
    expect(auth.verifyAccessToken(access.accessToken)).toEqual({ ok: false, reason: 'client session suspended' })
    expect(() => auth.consumeWsTicket(ticket.ticket)).toThrow(expect.objectContaining({ code: 'unauthorized' }))
    expect(() => refresh(access.refreshToken)).toThrow(expect.objectContaining({ code: 'unauthorized', message: 'client session suspended' }))

    expect(auth.setClientSessionSuspended(paired.clientSessionId, false)).toBe(true)
    expect(auth.listClientSessions()[0]?.suspendedAt).toBeNull()
    expect(auth.verifyAccessToken(refresh(access.refreshToken).accessToken).ok).toBe(true)
    expect(closed).toHaveLength(1)
  })

  it('keeps one session per device key: pairing again replaces the old one', () => {
    const { auth } = setup()
    const device = generateEd25519KeyPair()
    const closed: string[] = []
    auth.onRevoke = (id) => closed.push(id)
    const first = auth.exchangePairingToken({
      pairingToken: auth.createPairingToken().token,
      devicePublicKeyPem: device.publicKeyPem,
      platform: 'darwin',
    })
    const second = auth.exchangePairingToken({
      pairingToken: auth.createPairingToken().token,
      devicePublicKeyPem: device.publicKeyPem,
      platform: 'darwin',
    })
    expect(closed).toEqual([first.clientSessionId])
    const live = auth.listClientSessions().filter((s) => s.revokedAt === null)
    expect(live.map((s) => [s.clientSessionId, s.platform])).toEqual([[second.clientSessionId, 'darwin']])
  })

  it('pauses every session without touching them, then lets them back in', () => {
    const { auth } = setup()
    const device = generateEd25519KeyPair()
    const paired = auth.exchangePairingToken({
      pairingToken: auth.createPairingToken().token,
      devicePublicKeyPem: device.publicKeyPem,
    })
    const proof = `refresh:${paired.clientSessionId}:${Date.now()}`
    const access = auth.refreshAccess({
      refreshToken: paired.refreshToken,
      proofPayload: proof,
      proofSignature: signPayload(device.privateKeyPem, proof),
      verifyDeviceProof: verifyPayload,
    })
    const closed: string[] = []
    auth.onRevoke = (id) => closed.push(id)

    auth.setAccessPaused(true)
    expect(closed).toEqual([paired.clientSessionId])
    expect(auth.verifyAccessToken(access.accessToken)).toEqual({ ok: false, reason: 'client session suspended' })
    expect(auth.listClientSessions()[0]?.suspendedAt).toBeNull()

    auth.setAccessPaused(false)
    expect(auth.verifyAccessToken(access.accessToken).ok).toBe(true)
  })

  it('does not suspend a revoked session', () => {
    const { auth } = setup()
    const paired = auth.exchangePairingToken({
      pairingToken: auth.createPairingToken().token,
      devicePublicKeyPem: generateEd25519KeyPair().publicKeyPem,
    })
    auth.revokeClientSession(paired.clientSessionId)
    expect(auth.setClientSessionSuspended(paired.clientSessionId, true)).toBe(false)
  })

  it('allows immediately-previous refresh within grace instead of revoking', () => {
    const { auth, db } = setup()
    const device = generateEd25519KeyPair()
    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
    })

    const proof1 = `refresh:${paired.clientSessionId}:${Date.now()}`
    const first = auth.refreshAccess({
      refreshToken: paired.refreshToken,
      proofPayload: proof1,
      proofSignature: signPayload(device.privateKeyPem, proof1),
      verifyDeviceProof: verifyPayload,
    })

    // Lost-response / concurrent retry presents the just-rotated-away token.
    const proof2 = `refresh:${paired.clientSessionId}:${Date.now()}`
    const recovered = auth.refreshAccess({
      refreshToken: paired.refreshToken,
      proofPayload: proof2,
      proofSignature: signPayload(device.privateKeyPem, proof2),
      verifyDeviceProof: verifyPayload,
    })
    expect(recovered.refreshToken).toBeTruthy()
    expect(recovered.refreshToken).not.toBe(paired.refreshToken)
    expect(recovered.refreshToken).not.toBe(first.refreshToken)

    const st = db
      .prepare('SELECT revoked_at FROM client_sessions WHERE client_session_id = ?')
      .get(paired.clientSessionId) as { revoked_at: number | null }
    expect(st.revoked_at).toBeNull()

    // Current generation after grace recovery still works.
    const proof3 = `refresh:${paired.clientSessionId}:${Date.now()}`
    const again = auth.refreshAccess({
      refreshToken: recovered.refreshToken,
      proofPayload: proof3,
      proofSignature: signPayload(device.privateKeyPem, proof3),
      verifyDeviceProof: verifyPayload,
    })
    expect(again.accessToken).toBeTruthy()
  })

  it('revokes when previous refresh is presented after grace expires', () => {
    const { auth, db } = setup()
    const device = generateEd25519KeyPair()
    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
    })

    const proof1 = `refresh:${paired.clientSessionId}:${Date.now()}`
    const first = auth.refreshAccess({
      refreshToken: paired.refreshToken,
      proofPayload: proof1,
      proofSignature: signPayload(device.privateKeyPem, proof1),
      verifyDeviceProof: verifyPayload,
    })

    // Age the reuse-log entry past the grace window.
    db.prepare('UPDATE refresh_reuse_log SET seen_at = ?').run(Date.now() - 120_000)

    const proof2 = `refresh:${paired.clientSessionId}:${Date.now()}`
    expect(() =>
      auth.refreshAccess({
        refreshToken: paired.refreshToken,
        proofPayload: proof2,
        proofSignature: signPayload(device.privateKeyPem, proof2),
        verifyDeviceProof: verifyPayload,
      }),
    ).toThrow(/reuse/)

    const st = db
      .prepare('SELECT revoked_at FROM client_sessions WHERE client_session_id = ?')
      .get(paired.clientSessionId) as { revoked_at: number | null }
    expect(st.revoked_at).not.toBeNull()

    const proof3 = `refresh:${paired.clientSessionId}:${Date.now()}`
    expect(() =>
      auth.refreshAccess({
        refreshToken: first.refreshToken,
        proofPayload: proof3,
        proofSignature: signPayload(device.privateKeyPem, proof3),
        verifyDeviceProof: verifyPayload,
      }),
    ).toThrow()
  })

  it('allows concurrent retries of the same previous token within grace', () => {
    const { auth, db } = setup()
    const device = generateEd25519KeyPair()
    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
    })

    const t0 = paired.refreshToken
    const proof1 = `refresh:${paired.clientSessionId}:${Date.now()}`
    auth.refreshAccess({
      refreshToken: t0,
      proofPayload: proof1,
      proofSignature: signPayload(device.privateKeyPem, proof1),
      verifyDeviceProof: verifyPayload,
    })

    // Two in-flight clients both still hold t0 (classic race).
    const proofA = `refresh:${paired.clientSessionId}:${Date.now()}`
    const a = auth.refreshAccess({
      refreshToken: t0,
      proofPayload: proofA,
      proofSignature: signPayload(device.privateKeyPem, proofA),
      verifyDeviceProof: verifyPayload,
    })
    const proofB = `refresh:${paired.clientSessionId}:${Date.now()}`
    const b = auth.refreshAccess({
      refreshToken: t0,
      proofPayload: proofB,
      proofSignature: signPayload(device.privateKeyPem, proofB),
      verifyDeviceProof: verifyPayload,
    })
    expect(a.refreshToken).toBeTruthy()
    expect(b.refreshToken).toBeTruthy()

    const st = db
      .prepare('SELECT revoked_at FROM client_sessions WHERE client_session_id = ?')
      .get(paired.clientSessionId) as { revoked_at: number | null }
    expect(st.revoked_at).toBeNull()

    // Last issued current still refreshes.
    const proofC = `refresh:${paired.clientSessionId}:${Date.now()}`
    expect(
      auth.refreshAccess({
        refreshToken: b.refreshToken,
        proofPayload: proofC,
        proofSignature: signPayload(device.privateKeyPem, proofC),
        verifyDeviceProof: verifyPayload,
      }).accessToken,
    ).toBeTruthy()
  })

  it('revokes when a multi-generation-old token is presented after its grace expires', () => {
    const { auth, db } = setup()
    const device = generateEd25519KeyPair()
    const pairToken = auth.createPairingToken()
    const paired = auth.exchangePairingToken({
      pairingToken: pairToken.token,
      devicePublicKeyPem: device.publicKeyPem,
    })

    const t0 = paired.refreshToken
    const proof1 = `refresh:${paired.clientSessionId}:${Date.now()}`
    const gen1 = auth.refreshAccess({
      refreshToken: t0,
      proofPayload: proof1,
      proofSignature: signPayload(device.privateKeyPem, proof1),
      verifyDeviceProof: verifyPayload,
    })
    const proof2 = `refresh:${paired.clientSessionId}:${Date.now()}`
    const gen2 = auth.refreshAccess({
      refreshToken: gen1.refreshToken,
      proofPayload: proof2,
      proofSignature: signPayload(device.privateKeyPem, proof2),
      verifyDeviceProof: verifyPayload,
    })

    // Age only the oldest reuse entry (t0) past grace; gen1 stays "fresh".
    db.prepare(
      `UPDATE refresh_reuse_log SET seen_at = ?
       WHERE client_session_id = ? AND seen_at = (
         SELECT MIN(seen_at) FROM refresh_reuse_log WHERE client_session_id = ?
       )`,
    ).run(Date.now() - 120_000, paired.clientSessionId, paired.clientSessionId)

    const proof3 = `refresh:${paired.clientSessionId}:${Date.now()}`
    expect(() =>
      auth.refreshAccess({
        refreshToken: t0,
        proofPayload: proof3,
        proofSignature: signPayload(device.privateKeyPem, proof3),
        verifyDeviceProof: verifyPayload,
      }),
    ).toThrow(/reuse/)

    const st = db
      .prepare('SELECT revoked_at FROM client_sessions WHERE client_session_id = ?')
      .get(paired.clientSessionId) as { revoked_at: number | null }
    expect(st.revoked_at).not.toBeNull()

    const proof4 = `refresh:${paired.clientSessionId}:${Date.now()}`
    expect(() =>
      auth.refreshAccess({
        refreshToken: gen2.refreshToken,
        proofPayload: proof4,
        proofSignature: signPayload(device.privateKeyPem, proof4),
        verifyDeviceProof: verifyPayload,
      }),
    ).toThrow()
  })
})
