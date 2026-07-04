import { describe, expect, it } from 'vitest'
import { extractDraggedImageUrl } from './browser-image'

function fakeDataTransfer(data: Record<string, string>): DataTransfer {
  return { getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer
}

describe('extractDraggedImageUrl', () => {
  it('returns a data:image URL when dragging a bare image whose uri-list is the data URL', () => {
    const dt = fakeDataTransfer({
      'text/plain': 'data:image/png;base64,AAAA',
      'text/uri-list': 'data:image/png;base64,AAAA',
    })
    expect(extractDraggedImageUrl(dt)).toBe('data:image/png;base64,AAAA')
  })

  it('prefers the <img> src over a uri-list that points at the enclosing page', () => {
    const dt = fakeDataTransfer({
      'text/html': '<meta charset="utf-8"><img src="https://i0.cdn.example/pic.jpg@600w.avif">',
      'text/uri-list': 'https://www.example.com/watch/ep123',
    })
    expect(extractDraggedImageUrl(dt)).toBe('https://i0.cdn.example/pic.jpg@600w.avif')
  })

  it('falls back to the <img> src when there is no uri-list', () => {
    const dt = fakeDataTransfer({ 'text/html': "<img alt='x' src='https://a.test/pic.png'>" })
    expect(extractDraggedImageUrl(dt)).toBe('https://a.test/pic.png')
  })

  it('accepts a bare image uri-list with an image extension when no <img> html is present', () => {
    const dt = fakeDataTransfer({ 'text/uri-list': 'https://cdn.example.com/full.jpg?v=2' })
    expect(extractDraggedImageUrl(dt)).toBe('https://cdn.example.com/full.jpg?v=2')
  })

  it('ignores a dragged hyperlink / page URL that carries no image', () => {
    const dt = fakeDataTransfer({
      'text/plain': 'https://example.com/page',
      'text/uri-list': 'https://example.com/page',
      'text/html': '<a href="https://example.com/page">link</a>',
    })
    expect(extractDraggedImageUrl(dt)).toBeNull()
  })

  it('returns null for an empty drop', () => {
    expect(extractDraggedImageUrl(fakeDataTransfer({}))).toBeNull()
  })
})
