import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'
import { findAttachment, previewAttachment, withAttachmentPreviews, type ThumbnailEncoder } from './attachment-thumbnail'
import { stripEventForRemote, stripMessagesForRemote } from '../remote-content'

const FULL = Buffer.alloc(3000, 7).toString('base64')
const picture: ImageAttachment = { id: 'a1', name: 'IMG_0005.jpg', mimeType: 'image/jpeg', base64: FULL }
const pdf: ImageAttachment = { id: 'p1', name: 'report.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' }
const sent = (attachments: ImageAttachment[], id = 'user_1'): ChatMessage => ({
  id, role: 'user', status: 'complete', providerId: 'local', createdAt: '2026-09-12T00:00:00.000Z',
  content: [{ type: 'image', name: 'IMG_0005.jpg', id: 'a1' }, { type: 'text', text: 'look' }],
  attachments,
})
const tiny: ThumbnailEncoder = () => ({ base64: 'dGh1bWI=', mimeType: 'image/jpeg' })

describe('attachment thumbnails for the phone transcript', () => {
  it('replaces a picture with its thumbnail and flags it, leaving a PDF with no bytes', () => {
    const original = sent([picture, pdf])
    const message = withAttachmentPreviews(original, tiny)
    expect(message.attachments).toEqual([
      { id: 'a1', name: 'IMG_0005.jpg', mimeType: 'image/jpeg', base64: 'dGh1bWI=', preview: true },
      { id: 'p1', name: 'report.pdf', mimeType: 'application/pdf', base64: '', preview: true },
    ])
    // The blocks are untouched, and the host's own copy keeps its bytes.
    expect(message.content).toBe(original.content)
    expect(original.attachments?.[0].base64).toBe(FULL)
  })

  it('sends a picture it cannot decode as an icon chip rather than the full bytes', () => {
    const gif: ImageAttachment = { id: 'g1', name: 'loop.gif', mimeType: 'image/gif', base64: FULL }
    expect(previewAttachment(gif, () => null)).toEqual({ ...gif, base64: '', preview: true })
    expect(previewAttachment(gif, () => { throw new Error('boom') })).toEqual({ ...gif, base64: '', preview: true })
  })

  it('cuts each picture once, however many times history is re-sent', () => {
    const encode = vi.fn(tiny)
    const fresh: ImageAttachment = { id: 'cached', name: 'x.jpg', mimeType: 'image/jpeg', base64: Buffer.alloc(5000, 1).toString('base64') }
    withAttachmentPreviews(sent([fresh]), encode)
    withAttachmentPreviews(sent([fresh]), encode)
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('leaves an already-shrunk or byte-less message untouched, by identity', () => {
    const shrunk = withAttachmentPreviews(sent([picture]), tiny)
    expect(withAttachmentPreviews(shrunk, tiny)).toBe(shrunk)
    const stripped = sent([{ ...picture, base64: '' }])
    expect(withAttachmentPreviews(stripped, tiny)).toBe(stripped)
    const text = sent([])
    expect(withAttachmentPreviews(text, tiny)).toBe(text)
  })

  it('finds the original by id when there is one, by name otherwise', () => {
    const message = sent([picture, { ...picture, id: undefined, name: 'other.jpg' }])
    expect(findAttachment(message, { attachmentId: 'a1', name: 'wrong.jpg' })).toBe(message.attachments![0])
    expect(findAttachment(message, { name: 'other.jpg' })).toBe(message.attachments![1])
    expect(findAttachment(message, { attachmentId: 'nope', name: 'IMG_0005.jpg' })).toBeUndefined()
  })

  it('shrinks pictures on both remote projections: history pages and the live echo', () => {
    const [page] = stripMessagesForRemote([sent([picture])])
    expect(page.attachments?.[0]).toMatchObject({ preview: true })
    expect(page.attachments?.[0].base64).not.toBe(FULL)

    const live = stripEventForRemote({ type: 'user_message_appended', sessionId: 's1', projectPath: '/p', message: sent([picture], 'user_2') })
    expect(live.type === 'user_message_appended' && live.message.attachments?.[0]).toMatchObject({ preview: true })
    expect(live.type === 'user_message_appended' && live.message.attachments?.[0].base64).not.toBe(FULL)
  })
})
