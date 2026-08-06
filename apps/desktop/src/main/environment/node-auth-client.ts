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

const NODE_REQUEST_TIMEOUT_MS = 15_000

function endpointDescription(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '')
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
      return 'local SSH forward endpoint'
    }
  } catch {
    // Let fetch report the malformed URL with the normal remote endpoint context.
  }
  return 'remote node endpoint'
}

async function fetchNode(
  path: string,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  const url = `${path.replace(/\/$/, '')}`
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(NODE_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw Object.assign(
      new Error(`${operation} request failed for ${endpointDescription(url)} ${url}: ${detail}`),
      { code: 'unavailable', cause: error },
    )
  }
}

async function readNodeJson<T>(
  response: Response,
  operation: string,
  url: string,
): Promise<T> {
  try {
    return (await response.json()) as T
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw Object.assign(
      new Error(`${operation} returned invalid JSON from ${url}: ${detail}`),
      {
        code: 'unavailable',
        cause: error,
      },
    )
  }
}

export async function pairWithNode(input: {
  baseUrl: string
  pairingToken: string
  devicePublicKeyPem: string
  label?: string
}): Promise<PairResult> {
  const url = `${input.baseUrl.replace(/\/$/, '')}/v1/pair`
  const res = await fetchNode(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairingToken: input.pairingToken,
        devicePublicKeyPem: input.devicePublicKeyPem,
        label: input.label,
      }),
    },
    'pairing',
  )
  const body = await readNodeJson<
    PairResult & { error?: { code: string; message: string } }
  >(res, 'pairing', url)
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
  const url = `${input.baseUrl.replace(/\/$/, '')}/v1/token`
  const res = await fetchNode(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: input.refreshToken,
        proofPayload,
        proofSignature,
      }),
    },
    'token refresh',
  )
  const body = await readNodeJson<
    TokenResult & { error?: { code: string; message: string } }
  >(res, 'token refresh', url)
  if (!res.ok) {
    throw Object.assign(
      new Error(body.error?.message || 'token refresh failed'),
      {
        code: body.error?.code || 'unauthorized',
      },
    )
  }
  return body
}

export async function mintWsTicket(input: {
  baseUrl: string
  accessToken: string
}): Promise<string> {
  const url = `${input.baseUrl.replace(/\/$/, '')}/v1/ws-ticket`
  const res = await fetchNode(
    url,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    },
    'WebSocket ticket',
  )
  const body = await readNodeJson<{
    ticket?: string
    error?: { code: string; message: string }
  }>(res, 'WebSocket ticket', url)
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
