import { OFFICE_PREVIEW_MAX_BYTES } from '@superone/shared/file-preview'

export class OfficePreviewTooLargeError extends Error {
  constructor() {
    super('Office file exceeds the preview size limit.')
    this.name = 'OfficePreviewTooLargeError'
  }
}

/**
 * Read a preview URL into one ArrayBuffer, stopping at `maxBytes`.
 * `Content-Length` is checked before the body is consumed. A stream that
 * grows past the cap is cancelled so a data URI without a length header
 * cannot fill the WASM heap.
 */
export async function readOfficePreviewBytes(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  maxBytes: number = OFFICE_PREVIEW_MAX_BYTES,
): Promise<ArrayBuffer> {
  signal.throwIfAborted()
  const response = await fetcher(url, { signal })
  if (!response.ok) throw new Error('Office preview could not be read.')
  const advertised = Number(response.headers.get('Content-Length'))
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new OfficePreviewTooLargeError()
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxBytes) throw new OfficePreviewTooLargeError()
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new OfficePreviewTooLargeError()
      }
      chunks.push(value)
    }
  } catch (err) {
    await reader.cancel().catch(() => {})
    throw err
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer.slice(0)
}
