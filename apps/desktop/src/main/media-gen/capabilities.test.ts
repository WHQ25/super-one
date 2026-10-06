import { expect, it } from 'vitest'
import { imageCapabilities, videoCapabilities } from './capabilities'

it('describes Sora as size-framed with fixed clip lengths and no image inputs', () => {
  expect(videoCapabilities('openai', 'sora-2')).toMatchObject({ aspectRatios: [], durations: [4, 8, 12], references: false, firstFrame: false, seed: false })
})
it('offers audio only on Seedance models that generate it', () => {
  expect(videoCapabilities('ark', 'doubao-seedance-1-5-pro-251215').generateAudio).toBe(true)
  expect(videoCapabilities('ark', 'doubao-seedance-1-0-pro-250528').generateAudio).toBe(false)
})
it('follows the New API vendor behind the model id', () => {
  expect(videoCapabilities('newapi', 'kling-v2')).toMatchObject({ durations: [5, 10], references: false, lastFrame: true, watermark: false })
  expect(videoCapabilities('newapi', 'doubao-seedance-1-0-lite')).toMatchObject({ watermark: true, lastFrame: false })
  expect(videoCapabilities('newapi', 'unknown-model')).toMatchObject({ resolutions: [], durations: [] })
})
it('sizes images the way each adapter reads them', () => {
  expect(imageCapabilities('ark', 'doubao-seedream-4-0')).toEqual({ aspectRatios: [], sizes: ['2K', '4K'] })
  expect(imageCapabilities('google', 'gemini-2.5-flash-image')).toMatchObject({ sizes: ['1K', '2K', '4K'] })
  expect(imageCapabilities('google', 'imagen-4.0-generate-001').sizes).toEqual([])
  expect(imageCapabilities('openai', 'dall-e-3').sizes).toContain('1792x1024')
})
