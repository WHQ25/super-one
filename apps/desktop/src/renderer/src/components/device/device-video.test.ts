import { afterEach, describe, expect, it, vi } from 'vitest'
import { preferredDevicePreviewMode } from './device-video'

describe('preferredDevicePreviewMode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses H.264 when WebCodecs is available', () => {
    vi.stubGlobal('VideoDecoder', class {})
    expect(preferredDevicePreviewMode()).toBe('native-h264')
  })

  it('falls back to PNG when WebCodecs is unavailable', () => {
    vi.stubGlobal('VideoDecoder', undefined)
    expect(preferredDevicePreviewMode()).toBe('native-framebuffer')
  })
})
