import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

const image = { mimeType: 'image/png', base64: 'AAAA', name: 'shot.png', id: 'att-1' }
const queuedWithImage: ChatMessage = {
  id: 'q1',
  role: 'user',
  status: 'complete',
  content: [{ type: 'image', name: 'shot.png', id: 'att-1' }, { type: 'text', text: 'look' }],
  attachments: [image],
  createdAt: '',
  providerId: 'local',
}

describe('queued_messages_restored', () => {
  it('keeps a local queued bubble with its attachments instead of the text-only snapshot', () => {
    const session = { ...createDefaultChatCoreSession(), queuedMessages: [queuedWithImage] }
    const patch = applyEventToSession(session, {
      type: 'queued_messages_restored',
      messages: [{ clientMessageId: 'q1', content: 'look\n\n[Attached 1 file(s). …]' }],
    })
    expect(patch.queuedMessages).toEqual([queuedWithImage])
  })

  it('follows the snapshot for membership and order and adds unknown entries as text', () => {
    const other: ChatMessage = { ...queuedWithImage, id: 'q2', attachments: undefined, content: [{ type: 'text', text: 'two' }] }
    const session = { ...createDefaultChatCoreSession(), queuedMessages: [queuedWithImage, other] }
    const patch = applyEventToSession(session, {
      type: 'queued_messages_restored',
      messages: [
        { clientMessageId: 'q3', content: 'restored' },
        { clientMessageId: 'q1', content: 'look' },
      ],
    })
    expect(patch.queuedMessages?.map((m) => m.id)).toEqual(['q3', 'q1'])
    expect(patch.queuedMessages?.[0]?.content).toEqual([{ type: 'text', text: 'restored' }])
    expect(patch.queuedMessages?.[1]).toBe(queuedWithImage)
  })
})
