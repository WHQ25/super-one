import { describe, expect, it } from 'vitest'
import type { VideoModelV4CallOptions } from '../sdk-types'
import { buildNewApiVideoRequest, vendorForModel } from './request'

function options(overrides: Partial<VideoModelV4CallOptions> = {}): VideoModelV4CallOptions {
  return {
    prompt: 'a cat walking',
    n: 1,
    aspectRatio: undefined,
    resolution: undefined,
    duration: undefined,
    fps: undefined,
    seed: undefined,
    image: undefined,
    frameImages: undefined,
    inputReferences: undefined,
    generateAudio: undefined,
    providerOptions: {},
    ...overrides,
  }
}

describe('vendorForModel', () => {
  it('recognises doubao-* and kling-* model ids', () => {
    expect(vendorForModel('doubao-seedance-1-0-pro-250528')).toBe('doubao')
    expect(vendorForModel('kling-v2-master')).toBe('kling')
  })

  it('throws for a model id from an unsupported vendor rather than guessing', () => {
    expect(() => vendorForModel('vidu-q1')).toThrow(/Unrecognised newapi video model/)
  })
})

describe('buildNewApiVideoRequest — doubao branch', () => {
  it('sends a bare prompt with no metadata when nothing is specified', () => {
    const { body, warnings } = buildNewApiVideoRequest('doubao', 'doubao-seedance-2-0-260128', options())
    expect(body).toEqual({ model: 'doubao-seedance-2-0-260128', prompt: 'a cat walking' })
    expect(warnings).toEqual([])
  })

  it('maps ratio, resolution tier, seed, and generate_audio onto metadata (matching a direct Ark call)', () => {
    const { body } = buildNewApiVideoRequest(
      'doubao',
      'm',
      options({ aspectRatio: '16:9', resolution: '1920x1080', seed: 42, generateAudio: true }),
    )
    expect(body.metadata).toEqual({ ratio: '16:9', resolution: '1080p', seed: 42, generate_audio: true })
  })

  it('sends duration as the seconds string field, since Doubao never reads the sibling duration field', () => {
    const { body } = buildNewApiVideoRequest('doubao', 'm', options({ duration: 5 }))
    expect(body.seconds).toBe('5')
    expect(body.duration).toBeUndefined()
  })

  it('warns and drops a resolution that maps to no ark tier', () => {
    const { body, warnings } = buildNewApiVideoRequest('doubao', 'm', options({ resolution: '123x77' }))
    expect(body.metadata?.resolution).toBeUndefined()
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'resolution' })])
  })

  it('warns that fps is unsupported instead of sending a parameter Doubao does not have', () => {
    const { warnings } = buildNewApiVideoRequest('doubao', 'm', options({ fps: 24 }))
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'fps' })])
  })

  it('maps the first frame image (or the image shortcut) onto the top-level image field', () => {
    const { body } = buildNewApiVideoRequest(
      'doubao',
      'm',
      options({ image: { type: 'url', url: 'https://a/first.png' } }),
    )
    expect(body.image).toBe('https://a/first.png')
  })

  it('warns and drops a last-frame image, since the relay has no role for it on this vendor', () => {
    const { body, warnings } = buildNewApiVideoRequest(
      'doubao',
      'm',
      options({
        frameImages: [
          { image: { type: 'url', url: 'https://a/first.png' }, frameType: 'first_frame' },
          { image: { type: 'url', url: 'https://a/last.png' }, frameType: 'last_frame' },
        ],
      }),
    )
    expect(body.image).toBe('https://a/first.png')
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'last_frame_path' })])
  })

  it('carries inputReferences through as the plural images field', () => {
    const { body } = buildNewApiVideoRequest(
      'doubao',
      'm',
      options({ inputReferences: [{ type: 'url', url: 'https://a/ref.png' }] }),
    )
    expect(body.images).toEqual(['https://a/ref.png'])
  })

  it('warns that n>1 is ignored because the relay returns one video per task', () => {
    const { warnings } = buildNewApiVideoRequest('doubao', 'm', options({ n: 3 }))
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'n' })])
  })

  it('reads watermark/cameraFixed from the same providerOptions.ark namespace a direct Ark call uses', () => {
    const { body } = buildNewApiVideoRequest(
      'doubao',
      'm',
      options({ providerOptions: { ark: { watermark: false, cameraFixed: true } } }),
    )
    expect(body.metadata).toEqual({ watermark: false, camera_fixed: true })
  })
})

describe('buildNewApiVideoRequest — kling branch', () => {
  it('sends a bare prompt with no size/duration/metadata when nothing is specified', () => {
    const { body, warnings } = buildNewApiVideoRequest('kling', 'kling-v1', options())
    expect(body).toEqual({ model: 'kling-v1', prompt: 'a cat walking' })
    expect(warnings).toEqual([])
  })

  it('sends duration as the top-level int field, since Kling never reads the sibling seconds field', () => {
    const { body } = buildNewApiVideoRequest('kling', 'm', options({ duration: 5 }))
    expect(body.duration).toBe(5)
    expect(body.seconds).toBeUndefined()
  })

  it('sends resolution as the top-level size field, driving Kling\'s own aspect-ratio lookup', () => {
    const { body } = buildNewApiVideoRequest('kling', 'm', options({ resolution: '1280x720' }))
    expect(body.size).toBe('1280x720')
  })

  it('sends an explicit aspectRatio via metadata, overriding the size-derived lookup', () => {
    const { body } = buildNewApiVideoRequest('kling', 'm', options({ aspectRatio: '9:16' }))
    expect(body.metadata).toEqual({ aspect_ratio: '9:16' })
  })

  it('warns that seed, fps, and generateAudio are unsupported instead of sending parameters Kling does not have', () => {
    const { warnings } = buildNewApiVideoRequest('kling', 'm', options({ seed: 1, fps: 24, generateAudio: true }))
    const features = warnings.map((w) => (w as { feature?: string }).feature)
    expect(features).toEqual(expect.arrayContaining(['seed', 'fps', 'generateAudio']))
  })

  it('maps a last-frame image onto metadata.image_tail, since Kling has a real field for it', () => {
    const { body } = buildNewApiVideoRequest(
      'kling',
      'm',
      options({
        frameImages: [
          { image: { type: 'url', url: 'https://a/first.png' }, frameType: 'first_frame' },
          { image: { type: 'url', url: 'https://a/last.png' }, frameType: 'last_frame' },
        ],
      }),
    )
    expect(body.image).toBe('https://a/first.png')
    expect(body.metadata).toEqual({ image_tail: 'https://a/last.png' })
  })

  it('warns and drops inputReferences, since Kling only reads the singular first-frame image', () => {
    const { warnings } = buildNewApiVideoRequest(
      'kling',
      'm',
      options({ inputReferences: [{ type: 'url', url: 'https://a/ref.png' }] }),
    )
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'inputReferences' })])
  })

  it('warns that watermark/cameraFixed are unsupported, since they are Ark-only tool args', () => {
    const { warnings } = buildNewApiVideoRequest(
      'kling',
      'm',
      options({ providerOptions: { ark: { watermark: true } } }),
    )
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'watermark/camera_fixed' })])
  })
})
