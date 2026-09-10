import type { ReadDesktopFileResponse, ShareFileEncryption } from '@superone/shared/agent-types'
import {
  FILE_CHUNK_SIZE,
  FILE_ENVELOPE_HEADER_SIZE,
  FILE_GCM_IV_SIZE,
  FILE_GCM_TAG_SIZE,
  decryptBytesChunked,
} from './crypto'
import { substituteLanHost } from './lan-url'

export const MAX_DOWNLOAD_BYTES = 100 * 1_024 * 1_024

export type HttpGetResponse = {
  ok: boolean
  status: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export type HttpGet = (url: string) => Promise<HttpGetResponse>

/** A file the desktop staged encrypted on the relay: where it is and how to open it. */
export type EncryptedFile = {
  size: number
  downloadUrl: string
  expiresAt?: number
  encryption: ShareFileEncryption
}

export type DownloadEncryptedFileOptions = {
  file: EncryptedFile
  aesKeyBytes?: Uint8Array | null
  channelKeyHex?: string | null
  get?: HttpGet
  now?: () => number
}

export type DesktopFileResponse = Extract<ReadDesktopFileResponse, { url: string }>

export type DownloadDesktopFileOptions = Omit<DownloadEncryptedFileOptions, 'file'> & {
  file: DesktopFileResponse
  transport: 'lan' | 'relay'
  /** LAN host the phone is connected to; fills the desktop's `{lanHost}` URL placeholder. */
  lanHost?: string
}

function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('download: invalid file size')
  }
  if (size > MAX_DOWNLOAD_BYTES) {
    throw new Error('File too large to download (max 100 MB)')
  }
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

/** Download and authenticate a file the desktop staged encrypted on the relay. */
export async function downloadEncryptedFileBytes(opts: DownloadEncryptedFileOptions): Promise<Uint8Array> {
  const { file } = opts
  validateSize(file.size)

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
    return downloadEncryptedFileBytes({
      file: { size: file.size, downloadUrl: file.url, expiresAt: file.expiresAt, encryption: file.encryption },
      aesKeyBytes: opts.aesKeyBytes,
      channelKeyHex: opts.channelKeyHex,
      get: opts.get,
      now: opts.now,
    })
  }
  if (opts.transport !== 'lan') throw new Error('download: unencrypted relay file rejected')
  if ((opts.now ?? Date.now)() >= file.expiresAt) throw new Error('download: link expired')
  // Desktop signs LAN URLs as `http://{lanHost}:port/...`; resolve against the connected host first.
  const url = checkedDownloadUrl(substituteLanHost(file.url, opts.lanHost, 'download'), ['http:', 'https:'])
  const response = await (opts.get ?? defaultGet)(url)
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength !== file.size) throw new Error('download: file size mismatch')
  return bytes
}
