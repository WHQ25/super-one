import type {
  RemoteCommand,
  UploadFileCompleteResponse,
  UploadFileResponse,
} from '@superone/shared/agent-types'
import { bytesToBase64String, encryptBytesChunked } from './crypto'

export const INLINE_UPLOAD_MAX_BYTES = 256 * 1_024
export const MAX_UPLOAD_BYTES = 100 * 1_024 * 1_024

export type HttpPutResult = { savedPath?: string } | void
export type HttpPut = (url: string, body: Uint8Array, mimeType: string) => Promise<HttpPutResult>

export type UploadBytesOptions = {
  requestId: string
  projectPath?: string
  sessionId?: string
  targetDir: string
  name: string
  mimeType: string
  bytes: Uint8Array
  transport: 'lan' | 'relay'
  lanHost?: string
  aesKeyBytes?: Uint8Array
  channelKeyHex?: string
  request: (command: RemoteCommand, timeoutMs: number) => Promise<unknown>
  put: HttpPut
}

function checkedUrl(raw: string, protocols: readonly string[]): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('upload: invalid URL') }
  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new Error(`upload: rejected ${url.protocol || 'unknown'} URL`)
  }
  return url.toString()
}

export function resolveLanUploadUrl(raw: string, lanHost?: string): string {
  let resolved = raw
  if (resolved.includes('{lanHost}')) {
    if (!lanHost) throw new Error('upload: LAN host is unavailable')
    const host = lanHost.includes(':') && !lanHost.startsWith('[') ? `[${lanHost}]` : lanHost
    resolved = resolved.replaceAll('{lanHost}', host)
  }
  return checkedUrl(resolved, ['http:', 'https:'])
}

function parseUploadResponse(value: unknown): UploadFileResponse {
  if (!value || typeof value !== 'object') throw new Error('upload: invalid response')
  const response = value as Record<string, unknown>
  if (response.ok === false && typeof response.error === 'string') return value as UploadFileResponse
  if (response.ok !== true || typeof response.savedPath !== 'string') throw new Error('upload: invalid response')
  if (response.status === 'saved') return value as UploadFileResponse
  if (response.status === 'need_lan_put' && typeof response.uploadUrl === 'string') return value as UploadFileResponse
  if (
    response.status === 'need_r2_put'
    && typeof response.uploadUrl === 'string'
    && typeof response.key === 'string'
  ) return value as UploadFileResponse
  throw new Error('upload: invalid response')
}

function parseCompleteResponse(value: unknown): UploadFileCompleteResponse {
  if (!value || typeof value !== 'object') throw new Error('upload: invalid completion response')
  const response = value as Record<string, unknown>
  if (response.ok === true && typeof response.savedPath === 'string') return value as UploadFileCompleteResponse
  if (response.ok === false && typeof response.error === 'string') return value as UploadFileCompleteResponse
  throw new Error('upload: invalid completion response')
}

/**
 * Finish an upload_file RPC. Small files come back `saved`; large ones need a
 * LAN PUT (which saves directly) or encrypted relay R2 PUT plus completion.
 */
export async function finishUpload(opts: {
  response: UploadFileResponse
  bytes: Uint8Array
  mimeType: string
  lanHost?: string
  put: HttpPut
  complete: () => Promise<UploadFileCompleteResponse>
}): Promise<string> {
  const res = opts.response
  if (!res.ok) throw new Error(res.message ?? res.error)
  if (res.status === 'saved') return res.savedPath
  const uploadUrl = res.status === 'need_lan_put'
    ? resolveLanUploadUrl(res.uploadUrl, opts.lanHost)
    : checkedUrl(res.uploadUrl, ['https:'])
  const result = await opts.put(uploadUrl, opts.bytes, opts.mimeType)
  if (res.status === 'need_lan_put') return result?.savedPath ?? res.savedPath
  const done = await opts.complete()
  if (!done.ok) throw new Error(done.message ?? done.error)
  return done.savedPath
}

export async function uploadBytes(opts: UploadBytesOptions): Promise<string> {
  const size = opts.bytes.byteLength
  if (size > MAX_UPLOAD_BYTES) throw new Error('File too large to upload (max 100 MB)')
  if (!opts.name || !opts.targetDir || !opts.mimeType) throw new Error('upload: missing file metadata')

  const command: RemoteCommand = {
    type: 'upload_file',
    requestId: opts.requestId,
    ...(opts.projectPath ? { projectPath: opts.projectPath } : {}),
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    targetDir: opts.targetDir,
    name: opts.name,
    mimeType: opts.mimeType,
    size,
    ...(size <= INLINE_UPLOAD_MAX_BYTES ? { inlineBase64: bytesToBase64String(opts.bytes) } : {}),
  }
  const response = parseUploadResponse(await opts.request(command, 180_000))
  if (!response.ok || response.status === 'saved') {
    return finishUpload({
      response,
      bytes: opts.bytes,
      mimeType: opts.mimeType,
      put: opts.put,
      complete: async () => ({ ok: false, error: 'internal_error' }),
    })
  }

  let body = opts.bytes
  let putMimeType = opts.mimeType
  if (response.status === 'need_r2_put') {
    if (!opts.aesKeyBytes || !opts.channelKeyHex) throw new Error('upload: relay keys unavailable')
    body = encryptBytesChunked(opts.aesKeyBytes, opts.bytes, response.key, opts.channelKeyHex)
    putMimeType = 'application/octet-stream'
  }
  return finishUpload({
    response,
    bytes: body,
    mimeType: putMimeType,
    lanHost: opts.transport === 'lan' ? opts.lanHost : undefined,
    put: opts.put,
    complete: async () => parseCompleteResponse(await opts.request({
      type: 'upload_file_complete',
      requestId: opts.requestId,
    }, 180_000)),
  })
}

export function classifyUpload(res: UploadFileResponse): 'inline' | 'lan' | 'r2' | 'error' {
  if (!res.ok) return 'error'
  if (res.status === 'saved') return 'inline'
  if (res.status === 'need_lan_put') return 'lan'
  return 'r2'
}
