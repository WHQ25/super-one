import { accessSync, constants } from 'node:fs'
import { buildInlineAttachmentBlocks, persistAttachment, type AttachmentInput } from './attachment-store'
import { AttachmentError, attachmentBase64, validateTurnAttachments } from './attachment-validation'

// Reuse the admission write in the adapter without retaining attachments beyond their turn.
const savedInputs = new WeakMap<AttachmentInput, { base64: string; mimeType: string; name: string; path: string }>()
function saveForTurn(attachment: AttachmentInput, name: string): string | null {
  const saved = savedInputs.get(attachment)
  if (saved && saved.base64 === attachment.base64 && saved.mimeType === attachment.mimeType && saved.name === name) {
    try { accessSync(saved.path, constants.R_OK); return saved.path } catch { savedInputs.delete(attachment) }
  }
  const path = persistAttachment(attachment.base64, attachment.mimeType, { name })
  if (path) savedInputs.set(attachment, { base64: attachment.base64, mimeType: attachment.mimeType, name, path })
  return path
}

/** Admission happens before recording or queuing the user's turn. */
export function admitTurnAttachments(text: string, attachments: readonly AttachmentInput[] = []): void {
  validateTurnAttachments(attachments, text)
  if (attachments.length) buildAttachmentTurn(attachments, { inlineImages: false, requirePaths: true })
}

export interface PreparedAttachment extends AttachmentInput {
  index: number
  name: string
  path: string | null
  inline: boolean
  error?: string
}

export function buildAttachmentTurn(
  attachments: readonly AttachmentInput[] = [],
  opts: { inlineImages: boolean; inlinePdf?: boolean; requirePaths?: boolean },
) {
  validateTurnAttachments(attachments)
  const prepared: PreparedAttachment[] = attachments.map((attachment, index) => {
    const name = attachment.name || `attachment-${index + 1}`
    const inline = attachment.mimeType === 'application/pdf' ? Boolean(opts.inlinePdf) : opts.inlineImages
    const path = saveForTurn(attachment, name)
    if (!path && (!inline || opts.requirePaths)) throw new AttachmentError(`Could not save ${name}. Your attachment was not sent; retry the message.`)
    return { ...attachment, base64: attachmentBase64(attachment.base64), index, name, path, inline,
      ...(!path ? { error: `Could not save ${name}; file-path tools cannot use it.` } : {}) }
  })
  const note = prepared.length ? `[Attached ${prepared.length} file(s). ${prepared.some(a => a.inline)
    ? 'Images are included inline; do not Read them just to view them. ' : ''}Use the local path for file-path tools or selected PDF pages:\n${prepared.map(a => `${JSON.stringify(a.name)} → ${a.path ?? '(not saved locally)'}`).join('\n')}]` : ''
  return { attachments: prepared, inlineBlocks: buildInlineAttachmentBlocks(prepared.filter(a => a.inline)), note }
}

export function attachmentPrompt(text: string, note: string): string {
  return note ? (text.trim() ? `${text}\n\n${note}` : note) : text
}

export type AttachmentCodexInput = { type: 'text'; text: string; text_elements: [] } | { type: 'localImage'; path: string }

/** Codex reads localImage itself. Persistence failures must fail before dispatch. */
export function buildCodexAttachmentInput(text: string, images: readonly AttachmentInput[] = []): AttachmentCodexInput[] {
  validateTurnAttachments(images, text)
  const turn = buildAttachmentTurn(images, { inlineImages: false, requirePaths: true })
  const prompt = attachmentPrompt(text.trim(), turn.note)
  if (!prompt) throw new Error('Codex prompt is empty')
  const input: AttachmentCodexInput[] = [{ type: 'text', text: prompt, text_elements: [] }]
  for (const attachment of turn.attachments) {
    if (attachment.mimeType === 'application/pdf') continue
    accessSync(attachment.path!, constants.R_OK)
    input.push({ type: 'localImage', path: attachment.path! })
  }
  return input
}
