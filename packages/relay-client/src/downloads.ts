import type { ReadDesktopFileResponse, ShareFilePayload } from '@superone/shared/agent-types'
import {
  FILE_CHUNK_SIZE,
  FILE_ENVELOPE_HEADER_SIZE,
  FILE_GCM_IV_SIZE,
  FILE_GCM_TAG_SIZE,
  decryptBytesChunked,
} from './crypto'

export const MAX_DOWNLOAD_BYTES = 100 * 1_024 * 1_024

export type HttpGetResponse = {
  ok: boolean
  status: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export type HttpGet = (url: string) => Promise<HttpGetResponse>

export type DownloadSharedFileOptions = {
  file: ShareFilePayload
  aesKeyBytes?: Uint8Array | null
  channelKeyHex?: string | null
  get?: HttpGet
  now?: () => number
}

export type DesktopFileResponse = Extract<ReadDesktopFileResponse, { url: string }>

export type DownloadDesktopFileOptions = Omit<DownloadSharedFileOptions, 'file'> & {
  file: DesktopFileResponse
  transport: 'lan' | 'relay'
}

function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('download: invalid file size')
  }
  if (size > MAX_DOWNLOAD_BYTES) {
    throw new Error('File too large to download (max 100 MB)')
  }
}

function decodeBase64(data: string): Uint8Array {
  if (data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error('download: invalid inline base64')
  }
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(data, 'base64'))
  const binary = atob(data)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function checkedDownloadUrl(raw: string, protocols: readonly string[] = ['https:']): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('download: invalid URL') }
  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new Error(`download: rejected ${url.protocol || 'unknown'} URL`)
  }
  return url.toString()
}

function encryptedSize(plaintextSize: number): number {
  const chunks = plaintextSize === 0 ? 1 : Math.ceil(plaintextSize / FILE_CHUNK_SIZE)
  return FILE_ENVELOPE_HEADER_SIZE
    + plaintextSize
    + chunks * (FILE_GCM_IV_SIZE + FILE_GCM_TAG_SIZE)
}

const defaultGet: HttpGet = async (url) => fetch(url)

/** Download and authenticate a file delivered by the desktop mobile-share service. */
export async function downloadSharedFileBytes(opts: DownloadSharedFileOptions): Promise<Uint8Array> {
  const { file } = opts
  validateSize(file.size)

  if (file.inlineBase64 !== undefined) {
    const bytes = decodeBase64(file.inlineBase64)
    if (bytes.byteLength !== file.size) throw new Error('download: inline size mismatch')
    return bytes
  }

  if (!file.downloadUrl || !file.encryption) {
    throw new Error('download: missing file data')
  }
  if (file.expiresAt !== undefined && (opts.now ?? Date.now)() >= file.expiresAt) {
    throw new Error('download: link expired')
  }
  if (
    file.encryption.version !== 1
    || file.encryption.format !== 'chunked-v1'
    || !file.encryption.key
  ) {
    throw new Error('download: unsupported encryption metadata')
  }
  if (!opts.aesKeyBytes || !opts.channelKeyHex) {
    throw new Error('download: relay keys unavailable')
  }

  const response = await (opts.get ?? defaultGet)(checkedDownloadUrl(file.downloadUrl))
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const envelope = new Uint8Array(await response.arrayBuffer())
  if (envelope.byteLength !== encryptedSize(file.size)) {
    throw new Error('download: encrypted size mismatch')
  }
  const bytes = decryptBytesChunked(
    opts.aesKeyBytes,
    envelope,
    file.encryption.key,
    opts.channelKeyHex,
  )
  if (bytes.byteLength !== file.size) throw new Error('download: decrypted size mismatch')
  return bytes
}

/** Download a read_desktop_file response, allowing unencrypted HTTP only on the LAN transport. */
export async function downloadDesktopFileBytes(opts: DownloadDesktopFileOptions): Promise<Uint8Array> {
  const { file } = opts
  validateSize(file.size)
  if (file.encryption) {
    return downloadSharedFileBytes({
      file: {
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        downloadUrl: file.url,
        expiresAt: file.expiresAt,
        encryption: file.encryption,
      },
      aesKeyBytes: opts.aesKeyBytes,
      channelKeyHex: opts.channelKeyHex,
      get: opts.get,
      now: opts.now,
    })
  }
  if (opts.transport !== 'lan') throw new Error('download: unencrypted relay file rejected')
  if ((opts.now ?? Date.now)() >= file.expiresAt) throw new Error('download: link expired')
  const response = await (opts.get ?? defaultGet)(checkedDownloadUrl(file.url, ['http:', 'https:']))
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength !== file.size) throw new Error('download: file size mismatch')
  return bytes
}
