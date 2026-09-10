import { describe, expect, it, vi } from 'vitest'

const requestNative = vi.fn()
vi.mock('./bridge', () => ({ requestNative: (...args: unknown[]) => requestNative(...args) }))

const { isPreviewableImageSource, previewImage } = await import('./image-preview')

describe('previewImage', () => {
  it('accepts inline image bytes and public URLs only', () => {
    expect(isPreviewableImageSource('data:image/png;base64,AA==')).toBe(true)
    expect(isPreviewableImageSource('https://example.com/a.png')).toBe(true)
    expect(isPreviewableImageSource('HTTP://example.com/a.png')).toBe(true)
    expect(isPreviewableImageSource('docs/a.png')).toBe(false)
    expect(isPreviewableImageSource('data:text/plain;base64,AA==')).toBe(false)
    expect(isPreviewableImageSource(undefined)).toBe(false)
  })

  it('asks the host to open the viewer, omitting empty options', () => {
    requestNative.mockClear()
    previewImage('data:image/png;base64,AA==', { label: 'Screenshot', path: '/tmp/shot.png' })
    expect(requestNative).toHaveBeenCalledWith('previewImage', {
      src: 'data:image/png;base64,AA==', label: 'Screenshot', path: '/tmp/shot.png',
    })
    previewImage('https://example.com/a.png')
    expect(requestNative).toHaveBeenLastCalledWith('previewImage', { src: 'https://example.com/a.png' })
  })
})
