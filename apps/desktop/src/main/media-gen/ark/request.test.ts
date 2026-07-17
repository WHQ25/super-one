import { describe, expect, it } from 'vitest'
import type { ImageModelV3CallOptions } from '@ai-sdk/provider'
import { buildArkImageRequest } from './request'

function callOptions(overrides: Partial<ImageModelV3CallOptions> = {}): ImageModelV3CallOptions {
  return {
    prompt: 'a red brick',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
    ...overrides,
  }
}

const PNG_BYTES = new Uint8Array([137, 80, 78, 71])

describe('ark image request mapping', () => {
  it('asks for base64 rather than urls so the shared storage path can persist bytes', () => {
    const { body } = buildArkImageRequest('doubao-seedream-5-0-260128', callOptions())
    expect(body.response_format).toBe('b64_json')
  })

  it('falls back to 2K when no size is given, since seedream rejects anything under ~3.7MP', () => {
    const { body } = buildArkImageRequest('doubao-seedream-5-0-260128', callOptions())
    expect(body.size).toBe('2K')
  })

  it('passes an explicit size through untouched', () => {
    const { body } = buildArkImageRequest('doubao-seedream-5-0-260128', callOptions({ size: '2048x2048' }))
    expect(body.size).toBe('2048x2048')
  })

  it('sends a single reference image as a bare string, not an array', () => {
    const { body } = buildArkImageRequest(
      'doubao-seedream-5-0-260128',
      callOptions({ files: [{ type: 'file', mediaType: 'image/png', data: PNG_BYTES }] }),
    )
    expect(body.image).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`)
  })

  it('sends multiple reference images as an array', () => {
    const { body } = buildArkImageRequest(
      'doubao-seedream-5-0-260128',
      callOptions({
        files: [
          { type: 'file', mediaType: 'image/png', data: PNG_BYTES },
          { type: 'file', mediaType: 'image/jpeg', data: PNG_BYTES },
        ],
      }),
    )
    expect(Array.isArray(body.image)).toBe(true)
    expect(body.image).toHaveLength(2)
    expect((body.image as string[])[1]).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('omits image entirely for pure text-to-image', () => {
    const { body } = buildArkImageRequest('doubao-seedream-5-0-260128', callOptions())
    expect('image' in body).toBe(false)
  })

  it('prefixes bare base64 payloads, which ark rejects without the data uri header', () => {
    const { body } = buildArkImageRequest(
      'doubao-seedream-5-0-260128',
      callOptions({ files: [{ type: 'file', mediaType: 'image/webp', data: 'AAAA' }] }),
    )
    expect(body.image).toBe('data:image/webp;base64,AAAA')
  })

  it('leaves an already-formed data uri alone instead of double-prefixing it', () => {
    const { body } = buildArkImageRequest(
      'doubao-seedream-5-0-260128',
      callOptions({ files: [{ type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,AAAA' }] }),
    )
    expect(body.image).toBe('data:image/png;base64,AAAA')
  })

  it('passes a url reference through as-is, since ark accepts urls directly', () => {
    const { body } = buildArkImageRequest(
      'doubao-seedream-5-0-260128',
      callOptions({ files: [{ type: 'url', url: 'https://example.com/a.png' }] }),
    )
    expect(body.image).toBe('https://example.com/a.png')
  })

  it('warns instead of failing when a mask is supplied, since ark has no inpainting endpoint', () => {
    const { body, warnings } = buildArkImageRequest(
      'doubao-seedream-5-0-260128',
      callOptions({
        files: [{ type: 'file', mediaType: 'image/png', data: PNG_BYTES }],
        mask: { type: 'file', mediaType: 'image/png', data: PNG_BYTES },
      }),
    )
    expect(warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'mask' }))
    expect(body).not.toHaveProperty('mask')
  })

  it('warns that aspectRatio is ignored because ark only sizes via size', () => {
    const { warnings } = buildArkImageRequest('doubao-seedream-5-0-260128', callOptions({ aspectRatio: '16:9' }))
    expect(warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'aspectRatio' }))
  })

  it('caps reference images at ark limit of 14 and reports the drop', () => {
    const files = Array.from({ length: 16 }, () => ({ type: 'file' as const, mediaType: 'image/png', data: PNG_BYTES }))
    const { body, warnings } = buildArkImageRequest('doubao-seedream-5-0-260128', callOptions({ files }))
    expect(body.image).toHaveLength(14)
    expect(warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'files' }))
  })

  it('stays silent when nothing was dropped or ignored', () => {
    const { warnings } = buildArkImageRequest(
      'doubao-seedream-5-0-260128',
      callOptions({ files: [{ type: 'file', mediaType: 'image/png', data: PNG_BYTES }], size: '2K' }),
    )
    expect(warnings).toEqual([])
  })

  it('forwards seed only when the caller set one', () => {
    expect(buildArkImageRequest('m', callOptions({ seed: 42 })).body.seed).toBe(42)
    expect('seed' in buildArkImageRequest('m', callOptions()).body).toBe(false)
  })
})
