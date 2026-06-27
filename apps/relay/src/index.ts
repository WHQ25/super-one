import { computeHmacToken, computeRoomId, verifyTimestamp } from './auth'
import { isR2Configured, signPresignedDeleteUrl, signPresignedGetUrl, signPresignedPutUrl, type R2PresignEnv } from './r2-presign'

export { RelaySession } from './relay-session'
export { PairingSession } from './pairing-session'

interface Env extends Partial<R2PresignEnv> {
  RELAY_SESSION: DurableObjectNamespace
  PAIRING_SESSION: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') return handleRelay(request, url, env)
    if (url.pathname === '/status') return handleStatus(url, env)
    if (url.pathname === '/pair') return handlePairing(request, url, env)
    if (url.pathname === '/health') return new Response('ok')
    if (url.pathname === '/files/upload-url') return handleFileUploadUrl(request, env)
    if (url.pathname === '/files/download-url') return handleFileDownloadUrl(request, env)
    if (url.pathname === '/files/delete-url') return handleFileDeleteUrl(request, env)

    return new Response('Not found', { status: 404 })
  },
}

async function handleRelay(request: Request, url: URL, env: Env): Promise<Response> {
  const room = url.searchParams.get('room')
  const role = url.searchParams.get('role')
  const ts = url.searchParams.get('ts')

  if (!room || !role || !ts) {
    return new Response('Missing params: room, role, ts', { status: 400 })
  }
  if (role !== 'desktop' && role !== 'mobile') {
    return new Response('Invalid role', { status: 400 })
  }
  if (!verifyTimestamp(ts)) {
    return new Response('Token expired', { status: 401 })
  }

  const id = env.RELAY_SESSION.idFromName(room)
  const stub = env.RELAY_SESSION.get(id)
  return stub.fetch(request)
}

async function handleStatus(url: URL, env: Env): Promise<Response> {
  const room = url.searchParams.get('room')
  const ts = url.searchParams.get('ts')

  if (!room || !ts) {
    return new Response('Missing params: room, ts', { status: 400 })
  }
  if (!verifyTimestamp(ts)) {
    return new Response('Token expired', { status: 401 })
  }

  const id = env.RELAY_SESSION.idFromName(room)
  const stub = env.RELAY_SESSION.get(id)
  const statusUrl = new URL(`https://internal/status`)
  return stub.fetch(statusUrl.toString())
}

interface FileUrlRequestBody {
  channelKey?: string
  role?: 'desktop' | 'mobile'
  ts?: string
  sig?: string
  key?: string
  contentType?: string
  contentLength?: number
}

async function readJsonBody(request: Request): Promise<FileUrlRequestBody | null> {
  if (request.method !== 'POST') return null
  try {
    return (await request.json()) as FileUrlRequestBody
  } catch {
    return null
  }
}

async function authenticateFileRequest(
  body: FileUrlRequestBody,
  allowedRoles: ReadonlyArray<'desktop' | 'mobile'>,
): Promise<{ ok: true; channelKey: string; roomId: string } | { ok: false; status: number; message: string }> {
  if (!body.channelKey || !body.role || !body.ts || !body.sig) {
    return { ok: false, status: 400, message: 'Missing channelKey/role/ts/sig' }
  }
  if (!allowedRoles.includes(body.role)) {
    return { ok: false, status: 400, message: `role must be one of ${allowedRoles.join(',')}` }
  }
  if (!verifyTimestamp(body.ts)) {
    return { ok: false, status: 401, message: 'Token expired' }
  }
  const expectedSig = await computeHmacToken(body.channelKey, body.role, body.ts)
  if (expectedSig !== body.sig) {
    return { ok: false, status: 403, message: 'Invalid signature' }
  }
  const roomId = await computeRoomId(body.channelKey)
  return { ok: true, channelKey: body.channelKey, roomId }
}

function validateKeyForChannel(key: string | undefined, roomId: string): { ok: true; key: string } | { ok: false; status: number; message: string } {
  if (!key || typeof key !== 'string') {
    return { ok: false, status: 400, message: 'Missing key' }
  }
  const expectedPrefix = `files/${roomId}/`
  if (!key.startsWith(expectedPrefix)) {
    return { ok: false, status: 403, message: `key must start with ${expectedPrefix}` }
  }
  if (key.includes('..') || key.length > 1024) {
    return { ok: false, status: 400, message: 'invalid key' }
  }
  return { ok: true, key }
}

async function handleFileUploadUrl(request: Request, env: Env): Promise<Response> {
  if (!isR2Configured(env)) {
    return new Response('R2 not configured', { status: 503 })
  }
  const body = await readJsonBody(request)
  if (!body) return new Response('Bad request', { status: 400 })
  const auth = await authenticateFileRequest(body, ['desktop'])
  if (!auth.ok) return new Response(auth.message, { status: auth.status })
  const keyCheck = validateKeyForChannel(body.key, auth.roomId)
  if (!keyCheck.ok) return new Response(keyCheck.message, { status: keyCheck.status })
  try {
    const presigned = await signPresignedPutUrl(env, keyCheck.key, {
      contentType: body.contentType,
      contentLength: typeof body.contentLength === 'number' ? body.contentLength : undefined,
    })
    return Response.json({ uploadUrl: presigned.url, expiresAt: presigned.expiresAt })
  } catch (err) {
    return new Response(`presign failed: ${(err as Error).message}`, { status: 500 })
  }
}

async function handleFileDownloadUrl(request: Request, env: Env): Promise<Response> {
  if (!isR2Configured(env)) {
    return new Response('R2 not configured', { status: 503 })
  }
  const body = await readJsonBody(request)
  if (!body) return new Response('Bad request', { status: 400 })
  const auth = await authenticateFileRequest(body, ['desktop', 'mobile'])
  if (!auth.ok) return new Response(auth.message, { status: auth.status })
  const keyCheck = validateKeyForChannel(body.key, auth.roomId)
  if (!keyCheck.ok) return new Response(keyCheck.message, { status: keyCheck.status })
  try {
    const presigned = await signPresignedGetUrl(env, keyCheck.key)
    return Response.json({ downloadUrl: presigned.url, expiresAt: presigned.expiresAt })
  } catch (err) {
    return new Response(`presign failed: ${(err as Error).message}`, { status: 500 })
  }
}

async function handleFileDeleteUrl(request: Request, env: Env): Promise<Response> {
  if (!isR2Configured(env)) {
    return new Response('R2 not configured', { status: 503 })
  }
  const body = await readJsonBody(request)
  if (!body) return new Response('Bad request', { status: 400 })
  const auth = await authenticateFileRequest(body, ['desktop'])
  if (!auth.ok) return new Response(auth.message, { status: auth.status })
  const keyCheck = validateKeyForChannel(body.key, auth.roomId)
  if (!keyCheck.ok) return new Response(keyCheck.message, { status: keyCheck.status })
  try {
    const presigned = await signPresignedDeleteUrl(env, keyCheck.key)
    return Response.json({ deleteUrl: presigned.url, expiresAt: presigned.expiresAt })
  } catch (err) {
    return new Response(`presign failed: ${(err as Error).message}`, { status: 500 })
  }
}

async function handlePairing(request: Request, url: URL, env: Env): Promise<Response> {
  const channel = url.searchParams.get('channel')
  const role = url.searchParams.get('role')

  if (!channel || !role) {
    return new Response('Missing params: channel, role', { status: 400 })
  }
  if (role !== 'desktop' && role !== 'mobile') {
    return new Response('Invalid role', { status: 400 })
  }

  const id = env.PAIRING_SESSION.idFromName(channel)
  const stub = env.PAIRING_SESSION.get(id)
  return stub.fetch(request)
}
