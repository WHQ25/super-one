import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SendMessageRequest } from '@superone/shared/agent-types'
import { attachmentPrompt, buildAttachmentTurn } from '@superone/shared/attachment-turn'
import { validateTurnAttachments } from '@superone/shared/attachment-validation'

/** Normal sends and queued steering share the same attachment contract. */
export function buildUserMessage(request: SendMessageRequest, sessionId: string): SDKUserMessage {
  validateTurnAttachments(request.images, request.content)
  let content: unknown = request.content
  if (request.images?.length) {
    const turn = buildAttachmentTurn(request.images, { inlineImages: true, inlinePdf: false, requirePaths: true })
    content = [...turn.inlineBlocks, { type: 'text', text: attachmentPrompt(request.content, turn.note) }]
  }
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
    ...(request.priority ? { priority: request.priority } : {}),
  } as SDKUserMessage
}
