import { expect, it } from 'vitest'
import type { MediaVideoCapabilities } from '@superone/shared/media-composer'
import { fitImageSettings, fitVideoSettings, matchResolution, resolutionTier } from './media-capabilities'

const kling: MediaVideoCapabilities = { aspectRatios: ['16:9', '1:1'], resolutions: ['1280x720', '1920x1080'], durations: [5, 10],
  seed: false, generateAudio: false, watermark: false, cameraFixed: false, firstFrame: true, lastFrame: true, references: false }
const ref = (role: 'reference' | 'first' | 'last') => ({ name: role, mediaType: 'image/png', base64: 'AA==', role })

it('names pixel sizes by tier and keeps uncommon sizes readable', () => {
  expect(resolutionTier('1280x720')).toBe('720p')
  expect(resolutionTier('720x1280')).toBe('720p')
  expect(resolutionTier('1792x1024')).toBe('1792×1024')
  expect(resolutionTier('1080p')).toBe('1080p')
})

it('matches an agent tier name or a rotated size to a supported pixel size', () => {
  expect(matchResolution('720p', ['854x480', '1280x720'])).toBe('1280x720')
  expect(matchResolution('720x1280', ['1280x720', '720x1280'])).toBe('720x1280')
  expect(matchResolution('2560x1440', ['1280x720'])).toBeUndefined()
})

it('fits settings to a new model: Auto for user requests, first option for agent requests', () => {
  const settings = { aspectRatio: '21:9', resolution: '720p', duration: 8, seed: 3, watermark: true, references: [ref('reference'), ref('last')] }
  expect(fitVideoSettings(settings, kling, true)).toEqual({ aspectRatio: undefined, resolution: '1280x720', duration: undefined,
    seed: undefined, generateAudio: undefined, watermark: undefined, cameraFixed: undefined, references: [ref('first'), ref('last')].map((item, index) => index === 0 ? { ...item, name: 'reference' } : item) })
  expect(fitVideoSettings(settings, kling, false)).toMatchObject({ aspectRatio: '16:9', duration: 5 })
})

it('drops image settings the model does not read', () => {
  expect(fitImageSettings({ aspectRatio: '16:9', size: '2K' }, { aspectRatios: [], sizes: ['2K', '4K'] })).toEqual({ aspectRatio: undefined, size: '2K' })
})
