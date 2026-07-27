import { describe, expect, it } from 'vitest'
import {
  parseGoogleImageSizeTier,
  resolveGoogleImageGenerateOptions,
} from './google-image-options'
import type { GenerateMediaCoreParams, MediaProviderConfig } from './types'

const googleProvider: MediaProviderConfig = {
  id: 'google',
  kind: 'google',
  apiKey: 'test',
}

function params(overrides: Partial<GenerateMediaCoreParams> = {}): GenerateMediaCoreParams {
  return {
    provider: googleProvider,
    model: 'gemini-3-pro-image-preview',
    prompt: 'a cat',
    ...overrides,
  }
}

describe('parseGoogleImageSizeTier', () => {
  it('accepts 1K/2K/4K/512 case-insensitively', () => {
    expect(parseGoogleImageSizeTier('1K')).toBe('1K')
    expect(parseGoogleImageSizeTier('2k')).toBe('2K')
    expect(parseGoogleImageSizeTier(' 4K ')).toBe('4K')
    expect(parseGoogleImageSizeTier('512')).toBe('512')
  })

  it('rejects pixel sizes and unknown values', () => {
    expect(parseGoogleImageSizeTier('1024x1024')).toBeUndefined()
    expect(parseGoogleImageSizeTier('2k-hd')).toBeUndefined()
    expect(parseGoogleImageSizeTier(undefined)).toBeUndefined()
    expect(parseGoogleImageSizeTier('')).toBeUndefined()
  })
})

describe('resolveGoogleImageGenerateOptions', () => {
  it('passes size through unchanged when it is not a Google tier', () => {
    expect(resolveGoogleImageGenerateOptions(params({ size: '1024x1024', aspectRatio: '16:9' }))).toEqual({
      size: '1024x1024',
      aspectRatio: '16:9',
      providerOptions: undefined,
    })
  })

  it('maps size tier to providerOptions.google.imageConfig.imageSize and drops pixel size', () => {
    expect(resolveGoogleImageGenerateOptions(params({ size: '2K', aspectRatio: '16:9' }))).toEqual({
      size: undefined,
      aspectRatio: '16:9',
      providerOptions: {
        google: {
          imageConfig: {
            imageSize: '2K',
            aspectRatio: '16:9',
          },
        },
      },
    })
  })

  it('maps tier without aspectRatio', () => {
    expect(resolveGoogleImageGenerateOptions(params({ size: '4k' }))).toEqual({
      size: undefined,
      aspectRatio: undefined,
      providerOptions: {
        google: {
          imageConfig: {
            imageSize: '4K',
          },
        },
      },
    })
  })

  it('merges with existing providerOptions.google without dropping other knobs', () => {
    expect(
      resolveGoogleImageGenerateOptions(
        params({
          size: '1K',
          aspectRatio: '9:16',
          providerOptions: {
            google: {
              personGeneration: 'allow_adult',
              imageConfig: { imageSize: '4K' },
            },
          },
        }),
      ),
    ).toEqual({
      size: undefined,
      aspectRatio: '9:16',
      providerOptions: {
        google: {
          personGeneration: 'allow_adult',
          imageConfig: {
            imageSize: '1K',
            aspectRatio: '9:16',
          },
        },
      },
    })
  })
})
