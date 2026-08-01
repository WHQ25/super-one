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

  it('detects refresh token reuse and revokes the family', () => {
    const { auth } = setup()
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

    // Reuse old refresh token
    const proof2 = `refresh:${paired.clientSessionId}:${Date.now()}`
    expect(() =>
      auth.refreshAccess({
        refreshToken: paired.refreshToken,
        proofPayload: proof2,
        proofSignature: signPayload(device.privateKeyPem, proof2),
        verifyDeviceProof: verifyPayload,
      }),
    ).toThrow(/reuse/)

    // New refresh should also fail because session was revoked
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
})
