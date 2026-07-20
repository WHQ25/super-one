import { describe, expect, it } from 'vitest'
import { buildVideoCallOptions, normalizeImageData } from './call-options'
import type { GenerateVideoCoreParams } from './service'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

const PROVIDER = { id: 'c', kind: 'ark' as const, apiKey: 'k', baseURL: 'https://x' }
function params(extra: Partial<GenerateVideoCoreParams> = {}): GenerateVideoCoreParams {
  return { provider: PROVIDER, model: 'm', prompt: 'a cat', ...extra }
}

describe('image input normalisation', () => {
  it('keeps an http url as a url rather than trying to inline it', () => {
    expect(normalizeImageData('https://cdn.example/a.png')).toEqual({
      type: 'url',
      url: 'https://cdn.example/a.png',
    })
  })

  it('decodes a data uri into bytes and keeps its declared media type', () => {
    const uri = `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`

    const file = normalizeImageData(uri)

    expect(file).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
    expect(Buffer.from((file as { data: Uint8Array }).data)).toEqual(Buffer.from(JPEG))
  })

  it('sniffs the media type of a bare base64 string from its magic bytes', () => {
    const file = normalizeImageData(Buffer.from(PNG).toString('base64'))

    expect(file).toMatchObject({ type: 'file', mediaType: 'image/png' })
  })

  it('sniffs the media type of raw bytes rather than defaulting them all to png', () => {
    expect(normalizeImageData(JPEG)).toMatchObject({ type: 'file', mediaType: 'image/jpeg' })
    expect(normalizeImageData(PNG)).toMatchObject({ type: 'file', mediaType: 'image/png' })
  })
})

describe('video call options', () => {
  it('promotes the first_frame image to the start image the providers read', () => {
    const { options } = buildVideoCallOptions(
      params({ frameImages: [{ image: PNG, frameType: 'first_frame' }] }),
    )

    expect(options.image).toMatchObject({ type: 'file', mediaType: 'image/png' })
    expect(options.frameImages).toHaveLength(1)
  })

  it('drops input references when frame images are present, warning instead of silently mixing them', () => {
    const { options, warnings } = buildVideoCallOptions(
      params({
        frameImages: [{ image: PNG, frameType: 'first_frame' }],
        inputReferences: [JPEG],
      }),
    )

    expect(options.inputReferences).toBeUndefined()
    expect(warnings).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/cannot be combined/) }))
  })

  it('passes input references through when there are no frame images to conflict with', () => {
    const { options, warnings } = buildVideoCallOptions(params({ inputReferences: [JPEG, PNG] }))

    expect(options.inputReferences).toHaveLength(2)
    expect(warnings).toEqual([])
  })
})
