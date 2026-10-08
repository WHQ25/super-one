import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { userMessageParts } from '@superone/shared/user-message-parts'
import { plainMentionText, serializeMentionDocument, type MentionDocument, type MentionSegment, type MentionToken } from './mention-document'
import type { ComposerDraftSnapshot } from './composer-draft-state'

/** Explicit marks keep new plain text out of the bubble's legacy paste heuristic. */
export function composerMessageContent(document: MentionDocument, pasteChipsVisible = true): ContentBlock[] {
  const content: ContentBlock[] = []
  let text = ''
  const flush = () => {
    if (text.trim()) content.push({ type: 'text', text: text.trim(), isPaste: false })
    text = ''
  }
  for (const segment of document) {
    if ('paste' in segment && pasteChipsVisible) {
      flush()
      content.push({ type: 'text', text: segment.paste, isPaste: true })
    } else text += 'text' in segment ? segment.text : 'paste' in segment ? segment.paste : ` ${serializeMentionDocument([segment])} `
  }
  flush()
  return content
}

/** Edit/resend restores the composer's chips rather than flattening the bubble. */
export function composerDraftFromMessage(message: ChatMessage, current?: ComposerDraftSnapshot): ComposerDraftSnapshot {
  const document: MentionSegment[] = userMessageParts(message).flatMap((part): MentionSegment[] => {
    if ('paste' in part) return [{ paste: part.paste }]
    if ('mention' in part) return [{ mention: part.mention as MentionToken }]
    return 'text' in part ? [{ text: part.text }] : []
  })
  if (current && plainMentionText(current.document).trim()) document.push({ text: '\n\n' }, ...current.document)
  return { text: plainMentionText(document), document,
    insertions: document.flatMap((part) => 'mention' in part ? [{ text: plainMentionText([part]), mention: part.mention }] : []) }
}
