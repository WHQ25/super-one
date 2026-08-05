/**
 * Node/remote turn attachments — same unified store as desktop
 * (`@superone/shared/attachment-store` → `$TMPDIR/super-one-attachments`).
 */

import {
  buildAttachmentPathNote,
  buildInlineAttachmentBlocks,
  partitionAttachments,
  type AttachmentInput,
} from '@superone/shared/attachment-store'
import type { TurnImageAttachment } from '@superone/runtime/session'

function toInputs(
  images: TurnImageAttachment[] | undefined | null,
): AttachmentInput[] {
  if (!images?.length) return []
  return images.map((img) => ({
    name: img.name,
    mimeType: img.mimeType,
    base64: img.base64,
  }))
}

export type PreparedTurnPrompt =
  | { kind: 'text'; text: string }
  | {
      kind: 'multimodal'
      /** SDKUserMessage-shaped content: image/document blocks + optional text. */
      content: Array<Record<string, unknown>>
      /** Text-only fallback for harnesses that cannot take multimodal (Codex). */
      textFallback: string
    }

/**
 * Prepare prompt for a turn:
 * - Prefer path note for persisted files (desktop parity).
 * - If any attach fails to persist, build multimodal content blocks so Claude
 *   still sees the bytes (desktop buildUserMessage fallback).
 *
 * `cwd` is unused (storage is host-wide tmp); kept for call-site stability.
 */
export function prepareTurnPrompt(
  text: string,
  _cwd: string,
  images: TurnImageAttachment[] | undefined | null,
): PreparedTurnPrompt {
  const inputs = toInputs(images)
  if (inputs.length === 0) return { kind: 'text', text }

  const { saved, failed } = partitionAttachments(inputs)
  const note = buildAttachmentPathNote(saved)
  const textWithNote = note
    ? text.trim()
      ? `${text}\n\n${note}`
      : note
    : text

  if (failed.length === 0) {
    return { kind: 'text', text: textWithNote }
  }

  const blocks = buildInlineAttachmentBlocks(failed)
  if (textWithNote.trim()) {
    blocks.push({ type: 'text', text: textWithNote })
  }
  // Codex and other text-only runners fall back to path note + dropped failed.
  const textFallback =
    textWithNote.trim() ||
    (failed.length > 0
      ? `[${failed.length} attachment(s) could not be saved for path tools; Claude multimodal may still see them.]`
      : text)
  return { kind: 'multimodal', content: blocks, textFallback }
}

/** @deprecated Prefer {@link prepareTurnPrompt}. Text-only convenience. */
export function withAttachmentNote(
  text: string,
  cwd: string,
  images: TurnImageAttachment[] | undefined | null,
): string {
  const prepared = prepareTurnPrompt(text, cwd, images)
  return prepared.kind === 'text' ? prepared.text : prepared.textFallback
}

export function persistTurnAttachments(
  _cwd: string,
  images: TurnImageAttachment[] | undefined | null,
): { note: string; paths: string[] } {
  const { saved, failed } = partitionAttachments(toInputs(images))
  const noteBody = buildAttachmentPathNote(saved)
  // Mention failed counts only when some could not land on disk.
  const failNote =
    failed.length > 0
      ? `\n[${failed.length} attachment(s) could not be saved to the SuperOne attachments directory.]`
      : ''
  const note = noteBody || failNote ? `\n\n${noteBody}${failNote}`.trimEnd() : ''
  return {
    note: note ? (note.startsWith('\n') ? note : `\n\n${note}`) : '',
    paths: saved.map((s) => s.path),
  }
}
