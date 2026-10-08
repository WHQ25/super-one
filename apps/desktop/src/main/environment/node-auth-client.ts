import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto'
import type { AuthScope } from '@superone/shared/environment'
import {
  secureChannelAuthRequest,
  type ChannelCredential,
  type NodeSocketDialer,
} from '@superone/runtime/server/secure-channel-client'

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

export const NODE_REQUEST_TIMEOUT_MS = 15_000

/** Human-readable endpoint class for transport errors (not a root-cause label). */
export function nodeEndpointDescription(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '')
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
      return 'loopback node endpoint'
    }
  } catch {
    // Let fetch report the malformed URL with the normal remote endpoint context.
  }
  return 'remote node endpoint'
}

function transportErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  // AbortSignal.timeout() rejects with TimeoutError (DOMException) or AbortError.
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return `timed out after ${NODE_REQUEST_TIMEOUT_MS}ms`
  }
  return error.message
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
    const detail = transportErrorDetail(error)
    throw Object.assign(
      new Error(
        `${operation} request failed for ${nodeEndpointDescription(url)} ${url}: ${detail}`,
      ),
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

type NodeAuthPath = '/v1/pair' | '/v1/token' | '/v1/ws-ticket'

/**
 * One pairing/refresh/ticket exchange. Plain HTTP by default; when the node
 * requires its encrypted channel, the same request runs as a sealed frame.
 */
async function exchangeWithNode<T>(input: {
  baseUrl: string
  path: NodeAuthPath
  body: Record<string, unknown>
  accessToken?: string
  channel?: ChannelCredential
  /** Relay slot dialer; the exchange then runs only inside the channel. */
  dial?: NodeSocketDialer
  operation: string
}): Promise<T> {
  const url = `${input.baseUrl.replace(/\/$/, '')}${input.path}`
  let status: number
  let body: T & { error?: { code: string; message: string } }
  if (input.dial && !input.channel) {
    throw Object.assign(new Error(`${input.operation} over the relay needs the encrypted channel`), { code: 'invalid_config' })
  }
  if (input.channel) {
    const wsUrl = `${input.baseUrl.replace(/\/$/, '').replace(/^http/, 'ws')}/ws`
    try {
      const result = await secureChannelAuthRequest({
        wsUrl,
        credential: input.channel,
        path: input.path,
        body: input.body,
        accessToken: input.accessToken,
        timeoutMs: NODE_REQUEST_TIMEOUT_MS,
        dial: input.dial,
      })
      status = result.status
      body = (result.body ?? {}) as typeof body
    } catch (error) {
      const e = error as { code?: string; message?: string }
      throw Object.assign(
        new Error(`${input.operation} request failed for ${nodeEndpointDescription(url)} ${url}: ${e.message ?? String(error)}`),
        { code: e.code === 'unauthorized' ? 'unauthorized' : 'unavailable', cause: error },
      )
    }
  } else {
    const res = await fetchNode(
      url,
      {
        method: 'POST',
        headers: {
          ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}),
          'content-type': 'application/json',
        },
        body: JSON.stringify(input.body),
      },
      input.operation,
    )
    status = res.status
    body = await readNodeJson<typeof body>(res, input.operation, url)
  }
  if (status < 200 || status >= 300) {
    throw Object.assign(new Error(body.error?.message || `${input.operation} failed`), {
      code: body.error?.code || 'unauthorized',
    })
  }
  return body
}

export async function pairWithNode(input: {
  baseUrl: string
  pairingToken: string
  devicePublicKeyPem: string
  label?: string
  channel?: ChannelCredential
  dial?: NodeSocketDialer
}): Promise<PairResult> {
  return exchangeWithNode<PairResult>({
    baseUrl: input.baseUrl,
    path: '/v1/pair',
    body: {
      pairingToken: input.pairingToken,
      devicePublicKeyPem: input.devicePublicKeyPem,
      label: input.label,
    },
    channel: input.channel,
    dial: input.dial,
    operation: 'pairing',
  })
}

export async function refreshNodeAccess(input: {
  baseUrl: string
  refreshToken: string
  devicePrivateKeyPem: string
  clientSessionId: string
  channel?: ChannelCredential
  dial?: NodeSocketDialer
}): Promise<TokenResult> {
  const proofPayload = `refresh:${input.clientSessionId}:${Date.now()}`
  return exchangeWithNode<TokenResult>({
    baseUrl: input.baseUrl,
    path: '/v1/token',
    body: {
      refreshToken: input.refreshToken,
      proofPayload,
      proofSignature: signWithDeviceKey(input.devicePrivateKeyPem, proofPayload),
    },
    channel: input.channel,
    dial: input.dial,
    operation: 'token refresh',
  })
}

export async function mintWsTicket(input: {
  baseUrl: string
  accessToken: string
  channel?: ChannelCredential
  dial?: NodeSocketDialer
}): Promise<string> {
  const body = await exchangeWithNode<{ ticket?: string }>({
    baseUrl: input.baseUrl,
    path: '/v1/ws-ticket',
    body: {},
    accessToken: input.accessToken,
    channel: input.channel,
    dial: input.dial,
    operation: 'WebSocket ticket',
  })
  if (!body.ticket) {
    throw Object.assign(new Error('ws ticket failed'), { code: 'unauthorized' })
  }
  return body.ticket
}

/** Verify a PEM public key parses (basic validation). */
export function assertPublicKeyPem(pem: string): KeyObject {
  return createPublicKey(pem)
}
