import { describe, expect, it } from 'vitest'
import { MAX_CHAT_IMAGE_EDGE, chatImageFileName, planChatImage, sniffChatImageMime } from './chat-image-encoding'

describe('chat image encoding', () => {
  it('names the format from the bytes, not from what the picker claims', () => {
    expect(sniffChatImageMime('/9j/4AAQSkZJRgABAQAASABIAAD')).toBe('image/jpeg')
    expect(sniffChatImageMime('iVBORw0KGgoAAAANSUhEUgAA')).toBe('image/png')
    expect(sniffChatImageMime('R0lGODlhAQABAIAAAP')).toBe('image/gif')
    expect(sniffChatImageMime('UklGRiQAAABXRUJQVlA4')).toBe('image/webp')
    expect(sniffChatImageMime('data:image/jpeg;base64,/9j/4AAQ')).toBe('image/jpeg')
    // A simulator photo labelled image/heic by the picker: `ftypheic` in base64.
    expect(sniffChatImageMime('AAAAGGZ0eXBoZWljAAAAAG1p')).toBeNull()
    expect(sniffChatImageMime('')).toBeNull()
  })

  it('ships a readable picture that already fits untouched', () => {
    expect(planChatImage({ width: 1200, height: 900, mimeType: 'image/jpeg', fileName: 'IMG_0001.jpg' })).toEqual({ kind: 'raw' })
    expect(planChatImage({ width: 800, height: 600, mimeType: null, fileName: 'shot.png' })).toEqual({ kind: 'raw' })
    expect(planChatImage({ width: 800, height: 600, mimeType: 'image/webp', fileName: null })).toEqual({ kind: 'raw' })
  })

  it('re-encodes HEIC and other unreadable formats to JPEG even when small', () => {
    expect(planChatImage({ width: 1000, height: 750, mimeType: 'image/heic', fileName: 'IMG_0111.heic' }))
      .toEqual({ kind: 'encode', format: 'jpeg', edge: null })
    expect(planChatImage({ width: 1000, height: 750, mimeType: 'image/tiff', fileName: 'scan.tiff' }))
      .toEqual({ kind: 'encode', format: 'jpeg', edge: null })
    expect(planChatImage({ width: 1000, height: 750, mimeType: null, fileName: null }))
      .toEqual({ kind: 'encode', format: 'jpeg', edge: null })
  })

  it('scales a large picture to the edge limit, keeping PNG as PNG', () => {
    expect(planChatImage({ width: 4032, height: 3024, mimeType: 'image/jpeg', fileName: 'IMG_0005.jpg' }))
      .toEqual({ kind: 'encode', format: 'jpeg', edge: MAX_CHAT_IMAGE_EDGE })
    expect(planChatImage({ width: 1290, height: 2796, mimeType: 'image/png', fileName: 'screenshot.png' }))
      .toEqual({ kind: 'encode', format: 'png', edge: MAX_CHAT_IMAGE_EDGE })
    expect(planChatImage({ width: 3000, height: 4000, mimeType: 'image/heic', fileName: 'IMG_0111.heic' }))
      .toEqual({ kind: 'encode', format: 'jpeg', edge: MAX_CHAT_IMAGE_EDGE })
  })

  it('never re-encodes a GIF, which would drop its frames', () => {
    expect(planChatImage({ width: 5000, height: 5000, mimeType: 'image/gif', fileName: 'loop.gif' })).toEqual({ kind: 'raw' })
  })

  it('renames the file to match the bytes it now holds', () => {
    expect(chatImageFileName('IMG_0111.heic', 0, 'image/jpeg')).toBe('IMG_0111.jpg')
    expect(chatImageFileName('screenshot.png', 0, 'image/png')).toBe('screenshot.png')
    expect(chatImageFileName(null, 2, 'image/jpeg')).toBe('image-3.jpg')
    expect(chatImageFileName('archive.tar.gz', 0, 'image/webp')).toBe('archive.tar.webp')
  })
})
