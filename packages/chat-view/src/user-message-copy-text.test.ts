import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { wrapPathRefMention } from '@superone/shared/user-mention-parser'
import { userMessageCopyText } from './user-message-copy-text'

function userMessage(content: ChatMessage['content']): ChatMessage {
  return { id: 'u1', role: 'user', content, status: 'complete', createdAt: new Date().toISOString() } as ChatMessage
}

describe('userMessageCopyText', () => {
  it('joins text blocks and skips attachments', () => {
    const text = userMessageCopyText(userMessage([
      { type: 'text', text: 'first line' },
      { type: 'image', name: 'shot.png', mimeType: 'image/png', base64: 'AA==' } as ChatMessage['content'][number],
      { type: 'text', text: 'second line' },
    ]))
    expect(text).toBe('first line\nsecond line')
  })

  it('collapses a file mention to the chip label the bubble shows', () => {
    const mention = wrapPathRefMention('file', '/repo/src/index.ts', 'index.ts')
    const text = userMessageCopyText(userMessage([{ type: 'text', text: `look at ${mention} please` }]))
    expect(text).toBe('look at @index.ts please')
  })

  it('is empty for a message with no text', () => {
    expect(userMessageCopyText(userMessage([]))).toBe('')
  })
})
