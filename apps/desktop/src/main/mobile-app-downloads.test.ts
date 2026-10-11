import { describe, expect, it } from 'vitest'
import type { MobileUpdateManifest } from '@superone/shared/mobile-updates'
import { getMobileAppDownloads, mobileTrackForVariant } from './mobile-app-downloads'

const android: MobileUpdateManifest = {
  schemaVersion: 1,
  platform: 'android',
  version: '1.0.0',
  buildCode: 36,
  minSupportedBuildCode: 0,
  releasedAt: '2026-10-11T00:00:00.000Z',
  artifact: { url: 'https://dl.super-one.dev/mobile/android/alpha/superone-v1.0.0-build36.apk', md5: '0'.repeat(32), sizeBytes: 1 },
}

describe('mobileTrackForVariant', () => {
  it('pairs only the stable desktop with stable phones', () => {
    expect(mobileTrackForVariant('stable')).toBe('stable')
    expect(mobileTrackForVariant('alpha')).toBe('alpha')
    expect(mobileTrackForVariant('dev')).toBe('alpha')
  })
})

describe('getMobileAppDownloads', () => {
  it('reads both platforms from the track and keeps a missing one empty', async () => {
    const asked: string[] = []
    const downloads = await getMobileAppDownloads('alpha', async ({ platform, track }) => {
      asked.push(`${platform}/${track}`)
      return platform === 'android' ? android : null
    })
    expect(asked.sort()).toEqual(['android/alpha', 'ios/alpha'])
    expect(downloads).toEqual({
      track: 'alpha',
      android: { version: '1.0.0', buildCode: 36, url: android.artifact!.url },
      ios: null,
    })
  })
})
