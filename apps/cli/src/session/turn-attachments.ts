/**
 * Node/remote turn attachments — same unified store as desktop
 * (`@superone/shared/attachment-store` → `$TMPDIR/super-one-attachments`).
 */

import {
  buildAttachmentPathNote,
  partitionAttachments,
  type AttachmentInput,
} from '@superone/shared/attachment-store'
import { attachmentPrompt, buildAttachmentTurn } from '@superone/shared/attachment-turn'
import { validateTurnAttachments } from '@superone/shared/attachment-validation'
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
      /** Text representation for path-only callers. Codex uses typed localImage input. */
      textFallback: string
    }

/**
 * Prepare prompt for a turn:
 * Images are inline alongside saved paths; PDFs are referenced by path only.
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

  validateTurnAttachments(inputs, text)
  const turn = buildAttachmentTurn(inputs, { inlineImages: true, inlinePdf: false, requirePaths: true })
  const textWithNote = attachmentPrompt(text, turn.note)
  const blocks = [...turn.inlineBlocks, { type: 'text', text: textWithNote }]
  return { kind: 'multimodal', content: blocks, textFallback: textWithNote }

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
