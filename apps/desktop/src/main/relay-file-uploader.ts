import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { computeHmacToken, computeRoomId, decryptBytesChunked, encryptBytesChunked } from './remote-control-crypto'

const encoder = new TextEncoder()

export interface RelayFileUploadContext {
  channelKeyHex: string
  relayHttpUrl: string
  aesKey: webcrypto.CryptoKey
}

export interface RelayUploadEncryptionInfo {
  version: number
  format: 'chunked-v1'
  key: string
}

export interface RelayUploadResult {
  downloadUrl: string
  expiresAt: number
  key: string
  encryption: RelayUploadEncryptionInfo
}

export class RelayUploadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'RelayUploadError'
  }
}

function countingStream(data: Uint8Array, onProgress: (loadedFraction: number) => void): ReadableStream<Uint8Array> {
  const CHUNK = 64 * 1024
  const total = data.byteLength
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= total) {
        controller.close()
        return
      }
      const end = Math.min(offset + CHUNK, total)
      controller.enqueue(data.subarray(offset, end))
      offset = end
      onProgress(total === 0 ? 1 : offset / total)
    },
  })
}

export async function uploadFileToRelay(
  realPath: string,
  meta: { mimeType: string; size: number },
  sessionId: string,
  context: RelayFileUploadContext,
  onProgress?: (loadedFraction: number) => void,
): Promise<RelayUploadResult> {
  const roomId = await computeRoomId(context.channelKeyHex)
  const ts = Date.now()
  const keyHash = await sha256Hex(`${realPath}:${sessionId}:${ts}`)
  const key = `files/${roomId}/${keyHash.slice(0, 32)}.bin`

  const fileBytes = await readFile(realPath)
  const encrypted = await encryptBytesChunked(context.aesKey, fileBytes, key, context.channelKeyHex)
  const encryptedContentType = 'application/octet-stream'

  const uploadUrl = await fetchUploadUrl({
    relayHttpUrl: context.relayHttpUrl,
    channelKeyHex: context.channelKeyHex,
    key,
    contentType: encryptedContentType,
    contentLength: encrypted.byteLength,
  })
  const putBody: BodyInit = onProgress
    ? (countingStream(encrypted, onProgress) as unknown as BodyInit)
    : (encrypted as unknown as BodyInit)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: putBody,
    ...(onProgress ? { duplex: 'half' } : {}),
    headers: {
      'content-type': encryptedContentType,
      'content-length': String(encrypted.byteLength),
    },
  } as RequestInit)
  if (!putRes.ok) {
    const text = await safeText(putRes)
    throw new RelayUploadError(`R2 PUT failed: ${putRes.status} ${text}`, putRes.status)
  }

  const downloadResult = await fetchDownloadUrl({
    relayHttpUrl: context.relayHttpUrl,
    channelKeyHex: context.channelKeyHex,
    key,
  })
  return {
    downloadUrl: downloadResult.url,
    expiresAt: downloadResult.expiresAt,
    key,
    encryption: { version: 1, format: 'chunked-v1', key },
  }
}

async function fetchUploadUrl(opts: {
  relayHttpUrl: string
  channelKeyHex: string
  key: string
  contentType: string
  contentLength?: number
}): Promise<string> {
  const ts = Date.now().toString()
  const sig = await computeHmacToken(opts.channelKeyHex, 'desktop', ts)
  const res = await fetch(`${opts.relayHttpUrl}/files/upload-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channelKey: opts.channelKeyHex,
      role: 'desktop',
      ts, sig,
      key: opts.key,
      contentType: opts.contentType,
      ...(typeof opts.contentLength === 'number' ? { contentLength: opts.contentLength } : {}),
    }),
  })
  if (!res.ok) {
    throw new RelayUploadError(`upload-url failed: ${res.status} ${await safeText(res)}`, res.status)
  }
  const json = (await res.json()) as { uploadUrl?: string }
  if (!json.uploadUrl) throw new RelayUploadError('upload-url response missing uploadUrl')
  return json.uploadUrl
}

async function fetchDownloadUrl(opts: {
  relayHttpUrl: string
  channelKeyHex: string
  key: string
}): Promise<{ url: string; expiresAt: number }> {
  const ts = Date.now().toString()
  const sig = await computeHmacToken(opts.channelKeyHex, 'desktop', ts)
  const res = await fetch(`${opts.relayHttpUrl}/files/download-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channelKey: opts.channelKeyHex,
      role: 'desktop',
      ts, sig,
      key: opts.key,
    }),
  })
  if (!res.ok) {
    throw new RelayUploadError(`download-url failed: ${res.status} ${await safeText(res)}`, res.status)
  }
  const json = (await res.json()) as { downloadUrl?: string; expiresAt?: number }
  if (!json.downloadUrl) throw new RelayUploadError('download-url response missing downloadUrl')
  return { url: json.downloadUrl, expiresAt: json.expiresAt ?? Date.now() + 60_000 }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = encoder.encode(input)
  const buf = await webcrypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text() } catch { return '' }
}

export async function computeRelayUploadKey(context: RelayFileUploadContext, name: string): Promise<string> {
  const roomId = await computeRoomId(context.channelKeyHex)
  const rand = webcrypto.getRandomValues(new Uint8Array(16))
  const hash = Array.from(rand).map((b) => b.toString(16).padStart(2, '0')).join('')
  void name
  return `files/${roomId}/${hash}.bin`
}

export async function signRelayUploadUrl(context: RelayFileUploadContext, key: string): Promise<string> {
  return fetchUploadUrl({
    relayHttpUrl: context.relayHttpUrl,
    channelKeyHex: context.channelKeyHex,
    key,
    contentType: 'application/octet-stream',
  })
}

export async function downloadAndDecryptRelayFile(
  context: RelayFileUploadContext,
  key: string,
  onProgress?: (loadedFraction: number) => void,
): Promise<Buffer> {
  const { url } = await fetchDownloadUrl({
    relayHttpUrl: context.relayHttpUrl,
    channelKeyHex: context.channelKeyHex,
    key,
  })
  const res = await fetch(url)
  if (!res.ok) {
    throw new RelayUploadError(`R2 GET failed: ${res.status} ${await safeText(res)}`, res.status)
  }
  const encrypted = onProgress && res.body
    ? await readBodyWithProgress(res, onProgress)
    : new Uint8Array(await res.arrayBuffer())
  const decrypted = await decryptBytesChunked(context.aesKey, encrypted, key, context.channelKeyHex)
  return Buffer.from(decrypted)
}

async function readBodyWithProgress(
  res: Response,
  onProgress: (loadedFraction: number) => void,
): Promise<Uint8Array> {
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(total > 0 ? received / total : 0)
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  onProgress(1)
  return out
}

export async function deleteRelayFile(context: RelayFileUploadContext, key: string): Promise<void> {
  const ts = Date.now().toString()
  const sig = await computeHmacToken(context.channelKeyHex, 'desktop', ts)
  const res = await fetch(`${context.relayHttpUrl}/files/delete-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelKey: context.channelKeyHex, role: 'desktop', ts, sig, key }),
  })
  if (!res.ok) {
    throw new RelayUploadError(`delete-url failed: ${res.status} ${await safeText(res)}`, res.status)
  }
  const json = (await res.json()) as { deleteUrl?: string }
  if (!json.deleteUrl) throw new RelayUploadError('delete-url response missing deleteUrl')
  const del = await fetch(json.deleteUrl, { method: 'DELETE' })
  if (!del.ok && del.status !== 404) {
    throw new RelayUploadError(`R2 DELETE failed: ${del.status} ${await safeText(del)}`, del.status)
  }
}

export function relayWsToHttp(url: string): string {
  if (url.startsWith('wss://')) return 'https://' + url.slice('wss://'.length)
  if (url.startsWith('ws://')) return 'http://' + url.slice('ws://'.length)
  return url
}
