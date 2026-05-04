import { describe, it, expect } from 'vitest'
import { buildMiniAppFrameAttrs } from './miniapp-frame-attrs'

describe('buildMiniAppFrameAttrs', () => {
  it('returns sandbox=allow-scripts and empty allow when media is undefined', () => {
    expect(buildMiniAppFrameAttrs(undefined)).toEqual({ sandbox: 'allow-scripts', allow: '' })
  })

  it('returns sandbox=allow-scripts and empty allow when media is empty', () => {
    expect(buildMiniAppFrameAttrs([])).toEqual({ sandbox: 'allow-scripts', allow: '' })
  })

  it('adds allow-same-origin and microphone allow when microphone is granted', () => {
    expect(buildMiniAppFrameAttrs(['microphone'])).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'microphone *',
    })
  })

  it('adds allow-same-origin and camera allow when camera is granted', () => {
    expect(buildMiniAppFrameAttrs(['camera'])).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'camera *',
    })
  })

  it('joins multiple allow features with semicolons', () => {
    expect(buildMiniAppFrameAttrs(['microphone', 'camera'])).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'microphone *; camera *',
    })
  })

  it('preserves order of granted kinds in the allow attribute', () => {
    expect(buildMiniAppFrameAttrs(['camera', 'microphone'])).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'camera *; microphone *',
    })
  })
})
