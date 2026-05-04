import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { computeHmacToken, computeRoomId } from './remote-control-crypto'

const encoder = new TextEncoder()

export interface RelayFileUploadContext {
  channelKeyHex: string
  relayHttpUrl: string
}

export interface RelayUploadResult {
  downloadUrl: string
  expiresAt: number
  key: string
}

export class RelayUploadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'RelayUploadError'
  }
}

export async function uploadFileToRelay(
  realPath: string,
  meta: { mimeType: string; size: number },
  sessionId: string,
  context: RelayFileUploadContext,
): Promise<RelayUploadResult> {
  const roomId = await computeRoomId(context.channelKeyHex)
  const ts = Date.now()
  const keyHash = await sha256Hex(`${realPath}:${sessionId}:${ts}`)
  const key = `files/${roomId}/${keyHash.slice(0, 32)}.bin`

  const uploadUrl = await fetchUploadUrl({
    relayHttpUrl: context.relayHttpUrl,
    channelKeyHex: context.channelKeyHex,
    key,
    contentType: meta.mimeType,
    contentLength: meta.size,
  })
  const fileBytes = await readFile(realPath)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: fileBytes,
    headers: {
      'content-type': meta.mimeType,
      'content-length': String(meta.size),
    },
  })
  if (!putRes.ok) {
    const text = await safeText(putRes)
    throw new RelayUploadError(`R2 PUT failed: ${putRes.status} ${text}`, putRes.status)
  }

  const downloadResult = await fetchDownloadUrl({
    relayHttpUrl: context.relayHttpUrl,
    channelKeyHex: context.channelKeyHex,
    key,
  })
  return { downloadUrl: downloadResult.url, expiresAt: downloadResult.expiresAt, key }
}

async function fetchUploadUrl(opts: {
  relayHttpUrl: string
  channelKeyHex: string
  key: string
  contentType: string
  contentLength: number
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
      contentLength: opts.contentLength,
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

export function relayWsToHttp(url: string): string {
  if (url.startsWith('wss://')) return 'https://' + url.slice('wss://'.length)
  if (url.startsWith('ws://')) return 'http://' + url.slice('ws://'.length)
  return url
}
