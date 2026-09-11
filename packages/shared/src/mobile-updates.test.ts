import { describe, expect, it } from 'vitest'
import {
  androidApkObjectKey,
  androidApkUrl,
  evaluateMobileUpdate,
  fetchMobileUpdateManifest,
  isTrustedMobileUpdateUrl,
  mobileUpdateManifestUrl,
  parseMobileUpdateManifest,
} from './mobile-updates'

const APK_URL = 'https://dl.super-one.dev/mobile/android/superone-v1.0.0-build42.apk'

function androidManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    platform: 'android',
    version: '1.0.0',
    buildCode: 42,
    minSupportedBuildCode: 30,
    releasedAt: '2026-09-11T00:00:00.000Z',
    artifact: {
      url: APK_URL,
      md5: '0123456789abcdef0123456789abcdef',
      sizeBytes: 84_213_456,
    },
    ...overrides,
  }
}

function iosManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    platform: 'ios',
    version: '1.0.0',
    buildCode: 42,
    minSupportedBuildCode: 30,
    releasedAt: '2026-09-11T00:00:00.000Z',
    testflightUrl: 'https://testflight.apple.com/join/abcd1234',
    ...overrides,
  }
}

describe('object keys', () => {
  it('pins the APK to an immutable versioned key and the manifest to a stable one', () => {
    expect(androidApkObjectKey('1.0.0', 42)).toBe(
      'mobile/android/superone-v1.0.0-build42.apk',
    )
    expect(androidApkUrl('1.0.0', 42)).toBe(APK_URL)
    expect(mobileUpdateManifestUrl('android')).toBe(
      'https://dl.super-one.dev/mobile/android/latest.json',
    )
    expect(mobileUpdateManifestUrl('ios')).toBe(
      'https://dl.super-one.dev/mobile/ios/latest.json',
    )
  })

  it('refuses version strings that would escape the mobile prefix', () => {
    expect(() => androidApkObjectKey('../../alpha', 42)).toThrow(/unsafe version/)
    expect(() => androidApkObjectKey('1.0.0/x', 42)).toThrow(/unsafe version/)
    expect(() => androidApkObjectKey('  ', 42)).toThrow(/unsafe version/)
    expect(() => androidApkObjectKey('1.0.0', 0)).toThrow(/unsafe build code/)
    expect(() => androidApkObjectKey('1.0.0', 1.5)).toThrow(/unsafe build code/)
  })
})

describe('isTrustedMobileUpdateUrl', () => {
  it('accepts only the release CDN over https', () => {
    expect(isTrustedMobileUpdateUrl(APK_URL)).toBe(true)
    expect(isTrustedMobileUpdateUrl('http://dl.super-one.dev/mobile/x.apk')).toBe(false)
  })

  it('rejects the lookalikes a hostname check would let through', () => {
    // Suffix attack: a naive `endsWith('dl.super-one.dev')` on a parsed host
    // would still reject this, but a naive `includes` would not.
    expect(isTrustedMobileUpdateUrl('https://dl.super-one.dev.evil.com/mobile/x.apk')).toBe(false)
    // Userinfo attack: the real host here is `evil.com`.
    expect(isTrustedMobileUpdateUrl('https://dl.super-one.dev@evil.com/mobile/x.apk')).toBe(false)
    expect(isTrustedMobileUpdateUrl('https://dl.super-one.dev/mobile/../../etc/x.apk')).toBe(false)
    expect(isTrustedMobileUpdateUrl('https://dl.super-one.dev/mobile/x .apk')).toBe(false)
    expect(isTrustedMobileUpdateUrl('')).toBe(false)
  })
})

describe('parseMobileUpdateManifest', () => {
  it('accepts a well-formed android manifest', () => {
    const parsed = parseMobileUpdateManifest(androidManifest(), 'android')
    expect(parsed).toMatchObject({
      platform: 'android',
      version: '1.0.0',
      buildCode: 42,
      minSupportedBuildCode: 30,
      artifact: { url: APK_URL, sizeBytes: 84_213_456 },
    })
  })

  it('accepts a well-formed ios manifest', () => {
    const parsed = parseMobileUpdateManifest(iosManifest(), 'ios')
    expect(parsed).toMatchObject({
      platform: 'ios',
      buildCode: 42,
      testflightUrl: 'https://testflight.apple.com/join/abcd1234',
    })
    expect(parsed?.artifact).toBeUndefined()
  })

  it('treats an unknown schema version as no update rather than an error', () => {
    // Publishing schema 2 must not brick every build running schema 1.
    expect(parseMobileUpdateManifest(androidManifest({ schemaVersion: 2 }))).toBeNull()
    expect(parseMobileUpdateManifest(androidManifest({ schemaVersion: '1' }))).toBeNull()
  })

  it('rejects an artifact hosted anywhere but the release CDN', () => {
    expect(
      parseMobileUpdateManifest(
        androidManifest({
          artifact: {
            url: 'https://evil.com/superone-42.apk',
            md5: '0123456789abcdef0123456789abcdef',
            sizeBytes: 10,
          },
        }),
      ),
    ).toBeNull()
  })

  it('rejects a floor above the newest build', () => {
    // Such a manifest would hard-gate every user onto a build that does not
    // exist, with no client-side way out.
    expect(parseMobileUpdateManifest(androidManifest({ minSupportedBuildCode: 43 }))).toBeNull()
  })

  it('rejects malformed or missing fields', () => {
    expect(parseMobileUpdateManifest(null)).toBeNull()
    expect(parseMobileUpdateManifest([androidManifest()])).toBeNull()
    expect(parseMobileUpdateManifest(androidManifest({ platform: 'web' }))).toBeNull()
    expect(parseMobileUpdateManifest(androidManifest({ version: '  ' }))).toBeNull()
    expect(parseMobileUpdateManifest(androidManifest({ buildCode: -1 }))).toBeNull()
    expect(parseMobileUpdateManifest(androidManifest({ buildCode: '42' }))).toBeNull()
    expect(parseMobileUpdateManifest(androidManifest({ minSupportedBuildCode: undefined }))).toBeNull()
    expect(parseMobileUpdateManifest(androidManifest({ artifact: undefined }))).toBeNull()
    expect(
      parseMobileUpdateManifest(
        androidManifest({ artifact: { url: APK_URL, md5: 'nothex', sizeBytes: 1 } }),
      ),
    ).toBeNull()
    expect(parseMobileUpdateManifest(iosManifest({ testflightUrl: 'https://evil.com/join' }))).toBeNull()
  })

  it('rejects a manifest published under the wrong platform prefix', () => {
    expect(parseMobileUpdateManifest(iosManifest(), 'android')).toBeNull()
  })
})

describe('evaluateMobileUpdate', () => {
  const manifest = parseMobileUpdateManifest(androidManifest(), 'android')!

  it('offers an update when a newer build exists', () => {
    expect(evaluateMobileUpdate({ manifest, currentBuildCode: 41 })).toBe('optional')
  })

  it('stays quiet on the newest build, or a newer one', () => {
    expect(evaluateMobileUpdate({ manifest, currentBuildCode: 42 })).toBe('none')
    expect(evaluateMobileUpdate({ manifest, currentBuildCode: 43 })).toBe('none')
  })

  it('stays quiet once the user has dismissed this exact build', () => {
    expect(
      evaluateMobileUpdate({ manifest, currentBuildCode: 41, dismissedBuildCode: 42 }),
    ).toBe('none')
    // A dismissal is per-build, so the next release asks again.
    expect(
      evaluateMobileUpdate({ manifest, currentBuildCode: 41, dismissedBuildCode: 40 }),
    ).toBe('optional')
  })

  it('blocks below the floor, and a dismissal cannot buy past it', () => {
    expect(evaluateMobileUpdate({ manifest, currentBuildCode: 29 })).toBe('required')
    expect(
      evaluateMobileUpdate({ manifest, currentBuildCode: 29, dismissedBuildCode: 42 }),
    ).toBe('required')
  })

  it('stays quiet with no manifest or an unreadable build counter', () => {
    expect(evaluateMobileUpdate({ manifest: null, currentBuildCode: 1 })).toBe('none')
    // Locking the user out on the strength of a value we failed to read would
    // be worse than missing an update.
    expect(evaluateMobileUpdate({ manifest, currentBuildCode: null })).toBe('none')
    expect(evaluateMobileUpdate({ manifest, currentBuildCode: Number.NaN })).toBe('none')
  })
})

describe('fetchMobileUpdateManifest', () => {
  it('reads the platform manifest and validates it', async () => {
    const seen: string[] = []
    const manifest = await fetchMobileUpdateManifest({
      platform: 'android',
      fetchJson: async (url) => {
        seen.push(url)
        return androidManifest()
      },
    })
    expect(seen).toEqual(['https://dl.super-one.dev/mobile/android/latest.json'])
    expect(manifest?.buildCode).toBe(42)
  })

  it('collapses every failure to null so a foreground check stays silent', async () => {
    // Not-yet-published prefix.
    expect(
      await fetchMobileUpdateManifest({ platform: 'android', fetchJson: async () => null }),
    ).toBeNull()
    // Offline / DNS failure.
    expect(
      await fetchMobileUpdateManifest({
        platform: 'android',
        fetchJson: async () => {
          throw new Error('network down')
        },
      }),
    ).toBeNull()
    // Bucket served an HTML error page.
    expect(
      await fetchMobileUpdateManifest({ platform: 'android', fetchJson: async () => '<html>' }),
    ).toBeNull()
  })
})
