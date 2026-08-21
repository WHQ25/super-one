import type { UploadFileCompleteResponse, UploadFileResponse } from '@superone/shared/agent-types'

export type HttpPut = (url: string, body: Uint8Array, mimeType: string) => Promise<void>

/**
 * Finish an upload_file RPC. Small files come back `saved`; large ones need a
 * LAN PUT or relay R2 PUT, then upload_file_complete.
 */
export async function finishUpload(opts: {
  response: UploadFileResponse
  bytes: Uint8Array
  mimeType: string
  put: HttpPut
  complete: () => Promise<UploadFileCompleteResponse>
}): Promise<string> {
  const res = opts.response
  if (!res.ok) throw new Error(res.message ?? res.error)
  if (res.status === 'saved') return res.savedPath
  await opts.put(res.uploadUrl, opts.bytes, opts.mimeType)
  const done = await opts.complete()
  if (!done.ok) throw new Error(done.message ?? done.error)
  return done.savedPath
}

export function classifyUpload(res: UploadFileResponse): 'inline' | 'lan' | 'r2' | 'error' {
  if (!res.ok) return 'error'
  if (res.status === 'saved') return 'inline'
  if (res.status === 'need_lan_put') return 'lan'
  return 'r2'
}
