import { open, stat } from 'fs/promises'

/** Ordinary text files above this are not shipped to the renderer for preview. */
export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024

/**
 * Notebooks inline every plot and image as base64, so a routine analysis
 * notebook clears the text budget while still being worth previewing.
 * Local reads only — the remote path keeps `MAX_TRANSFER_BYTES` (10 MB)
 * because that budget also covers relay/LAN transfer.
 */
export const MAX_NOTEBOOK_BYTES = 50 * 1024 * 1024

const EXT_MAX_BYTES: Record<string, number> = {
  '.ipynb': MAX_NOTEBOOK_BYTES,
}

/** Byte budget for reading `ext` (leading dot, any case) as previewable text. */
export function maxReadableBytes(ext: string): number {
  return EXT_MAX_BYTES[ext.toLowerCase()] ?? MAX_TEXT_FILE_BYTES
}

const BINARY_SNIFF_BYTES = 8192

export async function detectTextOrBinary(
  fullPath: string,
  maxBytes: number,
): Promise<'text' | 'binary' | 'too-large'> {
  const st = await stat(fullPath)
  if (st.size > maxBytes) return 'too-large'
  if (st.size === 0) return 'text'
  const fd = await open(fullPath, 'r')
  try {
    const sniffSize = Math.min(BINARY_SNIFF_BYTES, st.size)
    const buf = Buffer.alloc(sniffSize)
    await fd.read(buf, 0, sniffSize, 0)
    return buf.includes(0) ? 'binary' : 'text'
  } finally {
    await fd.close()
  }
}
