import { escapeHtml, markSuperOneCopy, mentionCopyHtml, pasteCopyHtml, type CopiedMention } from '@/lib/clipboard'
import type { UserMessagePart } from './user-message-parts'

/** What a mention chip copies as in plain text: a path mention keeps its path. */
export function mentionCopyText({ kind, value, displayName }: CopiedMention): string {
  return `@${kind === 'file' || kind === 'directory' || kind === 'agent' ? value : displayName || value}`
}

/**
 * HTML flavour of a copied user message: its text, images, mentions and paste
 * chips in message order, images inline as `data:` URIs, so rich targets and
 * the composer's paste both keep everything where it was. The blocks are one
 * inline run, as the composer split them around its chips; only real newlines
 * and paste chips break. A PDF has no inline form and is left out.
 */
export function userCopyHtml(parts: UserMessagePart[]): string {
  return markSuperOneCopy(parts.map((part) => {
    if ('attachment' in part) {
      const { mimeType, base64, name } = part.attachment
      return mimeType.startsWith('image/') ? `<img src="data:${mimeType};base64,${base64}" alt="${escapeHtml(name)}">` : ''
    }
    if ('mention' in part) return mentionCopyHtml(part.mention, mentionCopyText(part.mention))
    if ('paste' in part) return pasteCopyHtml(part.paste)
    return escapeHtml(part.text).replace(/\n/g, '<br>')
  }).join(''))
}
