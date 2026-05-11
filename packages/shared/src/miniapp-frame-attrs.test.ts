import { describe, it, expect } from 'vitest'
import { buildMiniAppFrameAttrs } from './miniapp-frame-attrs'

describe('buildMiniAppFrameAttrs', () => {
  it('returns sandbox=allow-scripts and empty allow when called with no opts', () => {
    expect(buildMiniAppFrameAttrs()).toEqual({ sandbox: 'allow-scripts', allow: '' })
  })

  it('returns sandbox=allow-scripts and empty allow when media is undefined', () => {
    expect(buildMiniAppFrameAttrs({ grantedMedia: undefined })).toEqual({ sandbox: 'allow-scripts', allow: '' })
  })

  it('returns sandbox=allow-scripts and empty allow when media is empty', () => {
    expect(buildMiniAppFrameAttrs({ grantedMedia: [] })).toEqual({ sandbox: 'allow-scripts', allow: '' })
  })

  it('adds allow-same-origin and microphone allow when microphone is granted', () => {
    expect(buildMiniAppFrameAttrs({ grantedMedia: ['microphone'] })).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'microphone *',
    })
  })

  it('adds allow-same-origin and camera allow when camera is granted', () => {
    expect(buildMiniAppFrameAttrs({ grantedMedia: ['camera'] })).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'camera *',
    })
  })

  it('joins multiple allow features with semicolons', () => {
    expect(buildMiniAppFrameAttrs({ grantedMedia: ['microphone', 'camera'] })).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'microphone *; camera *',
    })
  })

  it('preserves order of granted kinds in the allow attribute', () => {
    expect(buildMiniAppFrameAttrs({ grantedMedia: ['camera', 'microphone'] })).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'camera *; microphone *',
    })
  })

  it('adds allow-same-origin when storage is granted', () => {
    expect(buildMiniAppFrameAttrs({ storage: true })).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: '',
    })
  })

  it('does not add allow-same-origin when storage is false', () => {
    expect(buildMiniAppFrameAttrs({ storage: false })).toEqual({
      sandbox: 'allow-scripts',
      allow: '',
    })
  })

  it('does not duplicate allow-same-origin when both storage and media are granted', () => {
    expect(buildMiniAppFrameAttrs({ storage: true, grantedMedia: ['microphone'] })).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'microphone *',
    })
  })
})
