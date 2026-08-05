/**
 * Unified SuperOne attachment persistence for every harness and host
 * (desktop Claude/Codex, remote node, etc.).
 *
 * Single directory: `$TMPDIR/super-one-attachments` (or SUPERONE_ATTACHMENTS_DIR).
 * Do not create per-harness sibling dirs (e.g. super-one-codex-attachments).
 *
 * Attachments are saved as files and referenced by path in the prompt so the
 * agent Reads them on demand (keeps base64 out of context until needed and
 * works with file-path tools such as image editing).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Directory name under the OS temp root. */
export const SUPERONE_ATTACHMENTS_DIR_NAME = 'super-one-attachments'

export interface AttachmentInput {
  /** Original file name (display + optional extension hint). */
  name?: string
  mimeType: string
  /** Raw or data-URL base64. */
  base64: string
}

export interface PersistedAttachment {
  name: string
  path: string
}

/**
 * Absolute directory for all SuperOne turn attachments on this host.
 * Override with SUPERONE_ATTACHMENTS_DIR for tests/lab.
 */
export function resolveAttachmentsDir(): string {
  const override = process.env.SUPERONE_ATTACHMENTS_DIR?.trim()
  if (override) return override
  return join(tmpdir(), SUPERONE_ATTACHMENTS_DIR_NAME)
}

export function extForAttachmentMime(mimeType: string): string {
  const m = mimeType.toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('bmp')) return 'bmp'
  if (m.includes('svg')) return 'svg'
  if (m.includes('png')) return 'png'
  return 'bin'
}

function decodeBase64(base64: string): Buffer | null {
  try {
    const raw = base64.includes(',') ? base64.split(',').pop()! : base64
    if (!raw) return null
    const buf = Buffer.from(raw, 'base64')
    if (buf.length === 0 || buf.length > 4_000_000) return null
    return buf
  } catch {
    return null
  }
}

function safeFileBase(name: string | undefined, mimeType: string): string {
  const cleaned = (name || `attachment-${randomUUID()}`)
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80)
  const base = cleaned || `attachment-${randomUUID()}`
  if (/\.\w{2,5}$/.test(base)) return base
  return `${base}.${extForAttachmentMime(mimeType)}`
}

/**
 * Persist one attachment into the unified SuperOne attachments directory.
 * Returns absolute path or null on failure.
 */
export function persistAttachment(
  base64: string,
  mimeType: string,
  opts?: { name?: string },
): string | null {
  const buf = decodeBase64(base64)
  if (!buf) return null
  try {
    const dir = resolveAttachmentsDir()
    mkdirSync(dir, { recursive: true })
    const fileName = `${randomUUID()}-${safeFileBase(opts?.name, mimeType)}`
    const filePath = join(dir, fileName)
    writeFileSync(filePath, buf)
    return filePath
  } catch {
    return null
  }
}

/**
 * Persist many attachments. Failed entries are omitted (order of successes only).
 * Prefer this over harness-specific writers.
 */
export function persistAttachments(
  images: AttachmentInput[] | undefined | null,
): PersistedAttachment[] {
  if (!images || images.length === 0) return []
  const out: PersistedAttachment[] = []
  for (const img of images) {
    if (!img?.mimeType || !img.base64) continue
    const path = persistAttachment(img.base64, img.mimeType, { name: img.name })
    if (!path) continue
    out.push({
      name: img.name || path.split(/[/\\]/).pop() || 'attachment',
      path,
    })
  }
  return out
}

/**
 * Agent-facing note: same wording for Claude, Codex, and remote node.
 * Returns '' when there are no files.
 */
export function buildAttachmentPathNote(files: Array<{ name: string; path: string }>): string {
  if (files.length === 0) return ''
  const list = files.map((file) => `${file.name} → ${file.path}`).join('\n')
  return (
    `[The user attached ${files.length} file${files.length > 1 ? 's' : ''}, saved locally. ` +
    `Read a path when you need its contents (e.g. to view an image), or pass it to a file-path tool ` +
    `such as image editing / image-to-image generation (reference_image_paths):\n${list}]`
  )
}

/** Append a path note to a text prompt when attachments persist successfully. */
export function withAttachmentPathNote(
  text: string,
  images: AttachmentInput[] | undefined | null,
): { text: string; files: PersistedAttachment[] } {
  const files = persistAttachments(images)
  if (files.length === 0) return { text, files: [] }
  const note = buildAttachmentPathNote(files)
  const next = text.trim() ? `${text}\n\n${note}` : note
  return { text: next, files }
}

/**
 * Partition attachments into successfully persisted paths vs failed (for
 * multimodal base64 fallback — desktop Claude buildUserMessage parity).
 */
export function partitionAttachments(
  images: AttachmentInput[] | undefined | null,
): { saved: PersistedAttachment[]; failed: AttachmentInput[] } {
  if (!images || images.length === 0) return { saved: [], failed: [] }
  const saved: PersistedAttachment[] = []
  const failed: AttachmentInput[] = []
  for (const img of images) {
    if (!img?.mimeType || !img.base64) continue
    const path = persistAttachment(img.base64, img.mimeType, { name: img.name })
    if (path) {
      saved.push({
        name: img.name || path.split(/[/\\]/).pop() || 'attachment',
        path,
      })
    } else {
      failed.push(img)
    }
  }
  return { saved, failed }
}

/**
 * Multimodal content blocks for SDKUserMessage when path persist fails
 * (matches desktop claude-query buildUserMessage fallback).
 */
export function buildInlineAttachmentBlocks(
  images: AttachmentInput[],
): Array<Record<string, unknown>> {
  return images.map((att) => {
    const raw = att.base64.includes(',') ? att.base64.split(',').pop()! : att.base64
    return {
      type: att.mimeType === 'application/pdf' ? 'document' : 'image',
      source: { type: 'base64', media_type: att.mimeType, data: raw },
    }
  })
}
