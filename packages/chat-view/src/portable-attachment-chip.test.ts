import { describe, expect, it, vi } from 'vitest'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { attachmentImageSource } from './portable-user-bubble-ports'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4FmcDAAN+AXFyCQ1WAAAAAElFTkSuQmCC'
const photo: ImageAttachment = { id: 'a1', name: 'IMG_0005.jpg', mimeType: 'image/png', base64: PNG }

describe('opening a user attachment on the phone', () => {
  it('opens a phone-painted picture from its own bytes, and a host thumbnail from the fetched original', async () => {
    await expect(attachmentImageSource('user_1', photo)).resolves.toBe(`data:image/png;base64,${PNG}`)

    const bridge = await import('./bridge')
    const request = vi.spyOn(bridge, 'requestNativeAsync').mockResolvedValue({ dataUri: 'data:image/jpeg;base64,/9j/' })
    await expect(attachmentImageSource('user_1', { ...photo, base64: 'dGh1bWI=', preview: true })).resolves.toBe('data:image/jpeg;base64,/9j/')
    expect(request).toHaveBeenCalledWith('loadAttachment', { messageId: 'user_1', name: 'IMG_0005.jpg', attachmentId: 'a1' })

    // A picture that came without bytes still opens its original.
    await expect(attachmentImageSource('user_1', { ...photo, base64: '' })).resolves.toBe('data:image/jpeg;base64,/9j/')

    request.mockResolvedValue({ error: 'gone' })
    await expect(attachmentImageSource('user_1', { ...photo, preview: true })).rejects.toThrow('attachment unavailable')
    request.mockRestore()
  })
})
