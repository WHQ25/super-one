import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto'
import type { AuthScope } from '@superone/shared/environment'

export interface DeviceKeyPair {
  privateKeyPem: string
  publicKeyPem: string
}

export interface PairResult {
  clientSessionId: string
  refreshToken: string
  scopes: AuthScope[]
  environmentId: string
  nodePublicKeyFingerprint: string
  expiresAt: number
}

export interface TokenResult {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: AuthScope[]
  clientSessionId: string
}

export function generateDeviceKeyPair(): DeviceKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

export function signWithDeviceKey(privateKeyPem: string, payload: string): string {
  const key = createPrivateKey(privateKeyPem)
  return sign(null, Buffer.from(payload), key).toString('base64url')
}

export async function pairWithNode(input: {
  baseUrl: string
  pairingToken: string
  devicePublicKeyPem: string
  label?: string
}): Promise<PairResult> {
  const res = await fetch(`${input.baseUrl.replace(/\/$/, '')}/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairingToken: input.pairingToken,
      devicePublicKeyPem: input.devicePublicKeyPem,
      label: input.label,
    }),
  })
  const body = (await res.json()) as PairResult & { error?: { code: string; message: string } }
  if (!res.ok) {
    throw Object.assign(new Error(body.error?.message || 'pair failed'), {
      code: body.error?.code || 'unauthorized',
    })
  }
  return body
}

export async function refreshNodeAccess(input: {
  baseUrl: string
  refreshToken: string
  devicePrivateKeyPem: string
  clientSessionId: string
}): Promise<TokenResult> {
  const proofPayload = `refresh:${input.clientSessionId}:${Date.now()}`
  const proofSignature = signWithDeviceKey(input.devicePrivateKeyPem, proofPayload)
  const res = await fetch(`${input.baseUrl.replace(/\/$/, '')}/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refreshToken: input.refreshToken,
      proofPayload,
      proofSignature,
    }),
  })
  const body = (await res.json()) as TokenResult & { error?: { code: string; message: string } }
  if (!res.ok) {
    throw Object.assign(new Error(body.error?.message || 'token refresh failed'), {
      code: body.error?.code || 'unauthorized',
    })
  }
  return body
}

export async function mintWsTicket(input: {
  baseUrl: string
  accessToken: string
}): Promise<string> {
  const res = await fetch(`${input.baseUrl.replace(/\/$/, '')}/v1/ws-ticket`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  const body = (await res.json()) as { ticket?: string; error?: { code: string; message: string } }
  if (!res.ok || !body.ticket) {
    throw Object.assign(new Error(body.error?.message || 'ws ticket failed'), {
      code: body.error?.code || 'unauthorized',
    })
  }
  return body.ticket
}

/** Verify a PEM public key parses (basic validation). */
export function assertPublicKeyPem(pem: string): KeyObject {
  return createPublicKey(pem)
}
