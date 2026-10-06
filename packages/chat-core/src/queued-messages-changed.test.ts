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

describe('queued_messages_changed', () => {
  it('keeps a local queued bubble with its attachment bytes instead of the host copy', () => {
    const session = { ...createDefaultChatCoreSession(), queuedMessages: [queuedWithImage] }
    const hostCopy: ChatMessage = { ...queuedWithImage, attachments: [{ ...image, base64: 'preview' }], providerId: 'remote' }
    const patch = applyEventToSession(session, { type: 'queued_messages_changed', messages: [hostCopy] })
    expect(patch.queuedMessages).toEqual([queuedWithImage])
  })

  it('follows the host for membership and order and adds messages another client queued', () => {
    const other: ChatMessage = { ...queuedWithImage, id: 'q2', attachments: undefined, content: [{ type: 'text', text: 'two' }] }
    const fromPhone: ChatMessage = { ...queuedWithImage, id: 'q3', providerId: 'remote' }
    const session = { ...createDefaultChatCoreSession(), queuedMessages: [queuedWithImage, other] }
    const patch = applyEventToSession(session, {
      type: 'queued_messages_changed',
      messages: [fromPhone, queuedWithImage],
    })
    expect(patch.queuedMessages?.map((m) => m.id)).toEqual(['q3', 'q1'])
    expect(patch.queuedMessages?.[0]).toBe(fromPhone)
    expect(patch.queuedMessages?.[1]).toBe(queuedWithImage)
  })
})
