import { afterEach, describe, expect, it, vi } from 'vitest'
import { preferredIosSimulatorPreviewMode } from './ios-simulator-video'

describe('preferredIosSimulatorPreviewMode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses H.264 when WebCodecs is available', () => {
    vi.stubGlobal('VideoDecoder', class {})
    expect(preferredIosSimulatorPreviewMode()).toBe('native-h264')
  })

  it('falls back to PNG when WebCodecs is unavailable', () => {
    vi.stubGlobal('VideoDecoder', undefined)
    expect(preferredIosSimulatorPreviewMode()).toBe('native-framebuffer')
  })
})
