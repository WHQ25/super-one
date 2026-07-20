import { describe, expect, it } from 'vitest'
import type { VideoModelV4CallOptions } from '../sdk-types'
import { buildArkVideoRequest } from './request'

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

function textOf(body: { content: { type: string; text?: string }[] }): string {
  return body.content.find((c) => c.type === 'text')?.text ?? ''
}

describe('buildArkVideoRequest', () => {
  it('sends a bare prompt with no settings fields when nothing is specified', () => {
    const { body, warnings } = buildArkVideoRequest('doubao-seedance-2-0-260128', options())
    expect(body.model).toBe('doubao-seedance-2-0-260128')
    expect(body.content).toEqual([{ type: 'text', text: 'a cat walking' }])
    expect(body.ratio).toBeUndefined()
    expect(body.duration).toBeUndefined()
    expect(body.seed).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('maps generation settings onto top-level JSON fields rather than prompt-text flags', () => {
    const { body } = buildArkVideoRequest('m', options({ aspectRatio: '16:9', duration: 5, seed: 42 }))
    expect(textOf(body)).toBe('a cat walking')
    expect(body.ratio).toBe('16:9')
    expect(body.duration).toBe(5)
    expect(body.seed).toBe(42)
  })

  it('warns that fps is unsupported instead of sending a parameter ark does not have', () => {
    const { body, warnings } = buildArkVideoRequest('m', options({ fps: 24 }))
    expect(textOf(body)).toBe('a cat walking')
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'fps' })])
  })

  it('maps a pixel resolution onto the nearest ark tier', () => {
    expect(buildArkVideoRequest('m', options({ resolution: '1920x1080' })).body.resolution).toBe('1080p')
    expect(buildArkVideoRequest('m', options({ resolution: '1280x720' })).body.resolution).toBe('720p')
    expect(buildArkVideoRequest('m', options({ resolution: '854x480' })).body.resolution).toBe('480p')
  })

  it('warns and drops a resolution that maps to no ark tier', () => {
    const { body, warnings } = buildArkVideoRequest('m', options({ resolution: '123x77' }))
    expect(body.resolution).toBeUndefined()
    expect(warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'resolution' }),
    ])
  })

  it('prefers an explicit ark resolution tier over the pixel resolution', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({ resolution: '1920x1080', providerOptions: { ark: { resolution: '2k' } } }),
    )
    expect(body.resolution).toBe('2k')
  })

  it('maps frameImages onto ark first/last frame roles', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({
        frameImages: [
          { image: { type: 'url', url: 'https://a/first.png' }, frameType: 'first_frame' },
          { image: { type: 'url', url: 'https://a/last.png' }, frameType: 'last_frame' },
        ],
      }),
    )
    expect(body.content.slice(1)).toEqual([
      { type: 'image_url', image_url: { url: 'https://a/first.png' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://a/last.png' }, role: 'last_frame' },
    ])
  })

  it('tags inputReferences as reference_image', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({ inputReferences: [{ type: 'url', url: 'https://a/ref.png' }] }),
    )
    expect(body.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://a/ref.png' },
      role: 'reference_image',
    })
  })

  it('prefixes bare base64 file data with a data URI, as ark rejects it otherwise', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({ inputReferences: [{ type: 'file', mediaType: 'image/jpeg', data: 'QUJD' }] }),
    )
    expect(body.content[1]).toMatchObject({ image_url: { url: 'data:image/jpeg;base64,QUJD' } })
  })

  it('leaves an already-prefixed data URI untouched', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({ inputReferences: [{ type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,QUJD' }] }),
    )
    expect(body.content[1]).toMatchObject({ image_url: { url: 'data:image/png;base64,QUJD' } })
  })

  it('caps reference images and warns about the dropped ones', () => {
    const refs = Array.from({ length: 11 }, (_, i) => ({ type: 'url' as const, url: `https://a/${i}.png` }))
    const { body, warnings } = buildArkVideoRequest('m', options({ inputReferences: refs }))
    expect(body.content.filter((c) => c.type === 'image_url')).toHaveLength(9)
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'inputReferences' })])
  })

  it('counts frame images against the same nine-image budget', () => {
    const refs = Array.from({ length: 9 }, (_, i) => ({ type: 'url' as const, url: `https://a/${i}.png` }))
    const { body, warnings } = buildArkVideoRequest(
      'm',
      options({
        frameImages: [{ image: { type: 'url', url: 'https://a/first.png' }, frameType: 'first_frame' }],
        inputReferences: refs,
      }),
    )
    expect(body.content.filter((c) => c.type === 'image_url')).toHaveLength(9)
    // The frame image is load-bearing, so it survives and a reference is dropped instead.
    expect(body.content[1]).toMatchObject({ role: 'first_frame' })
    expect(warnings).toHaveLength(1)
  })

  it('carries generateAudio as a top-level field, not a prompt flag', () => {
    const { body } = buildArkVideoRequest('m', options({ generateAudio: true }))
    expect(body.generate_audio).toBe(true)
    expect(textOf(body)).toBe('a cat walking')
  })

  it('passes ark watermark and cameraFixed through as top-level fields', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({ providerOptions: { ark: { watermark: false, cameraFixed: true } } }),
    )
    expect(textOf(body)).toBe('a cat walking')
    expect(body.watermark).toBe(false)
    expect(body.camera_fixed).toBe(true)
  })

  it('appends reference videos and audios as their own content parts', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({
        providerOptions: {
          ark: {
            referenceVideos: ['https://a/clip.mp4'],
            referenceAudios: ['https://a/track.mp3'],
          },
        },
      }),
    )
    expect(body.content.slice(1)).toEqual([
      { type: 'video_url', video_url: { url: 'https://a/clip.mp4' } },
      { type: 'audio_url', audio_url: { url: 'https://a/track.mp3' } },
    ])
  })

  it('warns that n>1 is ignored because ark returns one video per task', () => {
    const { warnings } = buildArkVideoRequest('m', options({ n: 3 }))
    expect(warnings).toEqual([expect.objectContaining({ type: 'unsupported', feature: 'n' })])
  })

  it('lets providerOptions.ark.body override a computed top-level field', () => {
    const { body } = buildArkVideoRequest(
      'm',
      options({ generateAudio: true, providerOptions: { ark: { body: { generate_audio: false, callback_url: 'https://cb' } } } }),
    )
    expect(body.generate_audio).toBe(false)
    expect((body as Record<string, unknown>).callback_url).toBe('https://cb')
  })
})
