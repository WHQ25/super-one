import type { ChatMessage, ContentBlock, ImageAttachment } from '@superone/shared/agent-types'

/** The optimistic turn matches the host's attachment-first message, whose echo is deduplicated by id. */
export function localUserMessage(id: string, text: string, images?: ImageAttachment[], userMessageContent?: ContentBlock[]): ChatMessage {
  return {
    id, role: 'user', status: 'complete',
    content: [
      ...(images ?? []).map((attachment): ContentBlock => (
        attachment.mimeType === 'application/pdf'
          ? { type: 'document', name: attachment.name, id: attachment.id }
          : { type: 'image', name: attachment.name, id: attachment.id }
      )),
      ...(userMessageContent ?? [{ type: 'text' as const, text, isPaste: false }]),
    ],
    createdAt: new Date().toISOString(), providerId: 'local',
    ...(images?.length ? { attachments: images } : {}),
  }
}
