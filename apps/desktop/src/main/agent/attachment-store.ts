import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import log from '../logger'

const ATTACHMENT_DIR = join(tmpdir(), 'super-one-attachments')

function extForMime(mimeType: string): string {
  if (mimeType.includes('pdf')) return 'pdf'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

/**
 * Persist a user-attached file's base64 to a temp file and return the absolute
 * path. Uploaded attachments are handed to the agent as a file path (not inline
 * bytes) so the agent Reads them on demand — keeping the base64 out of context
 * until it is actually needed, and letting file-path tools (e.g. image editing /
 * image-to-image generation via reference_image_paths) act on the same file.
 * tmpdir() is on the readable-asset whitelist and read-only tools auto-approve,
 * so the agent's Read tool reaches it without a permission prompt. Returns null
 * if the write fails.
 */
export function persistAttachment(base64: string, mimeType: string): string | null {
  try {
    mkdirSync(ATTACHMENT_DIR, { recursive: true })
    const filePath = join(ATTACHMENT_DIR, `${randomUUID()}.${extForMime(mimeType)}`)
    writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return filePath
  } catch (err) {
    log.warn('[attachment-store] failed to persist attachment', err)
    return null
  }
}

/**
 * Build the note that tells the agent where the user's attachments were saved,
 * so it Reads them on demand instead of receiving inline bytes. Shared by the
 * Claude and Codex turn builders. Returns '' when there are no files.
 */
export function buildAttachmentPathNote(files: { name: string; path: string }[]): string {
  if (files.length === 0) return ''
  const list = files.map((file) => `${file.name} → ${file.path}`).join('\n')
  return (
    `[The user attached ${files.length} file${files.length > 1 ? 's' : ''}, saved locally. ` +
    `Read a path when you need its contents (e.g. to view an image), or pass it to a file-path tool ` +
    `such as image editing / image-to-image generation (reference_image_paths):\n${list}]`
  )
}
