import { describe, expect, it } from 'vitest'
import { androidVersionName, parseApiLevel } from './android-version'

describe('androidVersionName', () => {
  it('names the version this machine actually runs', () => {
    // Verified against the booted AVD: ro.build.version.sdk=36, release=16.
    expect(androidVersionName(36)).toBe('Android 16')
  })

  it('extrapolates a level that ships after this code was written', () => {
    // The whole reason for arithmetic over a table: a hard-coded map goes stale the
    // day the next SDK lands, and "Android API 37" in the catalog reads as a bug.
    expect(androidVersionName(37)).toBe('Android 17')
    expect(androidVersionName(40)).toBe('Android 20')
  })

  it('keeps 12L, which took a level without taking a version', () => {
    expect(androidVersionName(32)).toBe('Android 12L')
    expect(androidVersionName(31)).toBe('Android 12')
  })

  it('falls back to history below where the arithmetic holds', () => {
    expect(androidVersionName(29)).toBe('Android 10')
    expect(androidVersionName(21)).toBe('Android 5.0')
  })

  it('names the level rather than inventing a version it cannot know', () => {
    expect(androidVersionName(19)).toBe('Android API 19')
  })

  it('says nothing specific when there is no level at all', () => {
    // An AVD whose config could not be read still has to render a row.
    expect(androidVersionName(0)).toBe('Android')
    expect(androidVersionName(Number.NaN)).toBe('Android')
  })
})

describe('parseApiLevel', () => {
  it('reads the level out of an AVD target', () => {
    expect(parseApiLevel('android-36')).toBe(36)
  })

  it('drops the image revision, which is not part of the level', () => {
    // `android-36.1` is still API 36 — the `.1` is a system-image respin.
    expect(parseApiLevel('android-36.1')).toBe(36)
  })

  it('reads it out of a system image path too', () => {
    expect(parseApiLevel('system-images/android-36.1/google_apis_playstore/arm64-v8a/')).toBe(36)
  })

  it('answers zero for a target it cannot read, rather than guessing', () => {
    expect(parseApiLevel('')).toBe(0)
    expect(parseApiLevel('android-Baklava')).toBe(0)
  })
})

describe('the 12L discontinuity', () => {
  it('does not carry one offset across it', () => {
    // Regression: assuming version = level - 20 from API 30 up looks right on any
    // modern device and is wrong for exactly 30 and 31, because Android 12L consumed
    // a level without consuming a version. Both sides are pinned here so a future
    // simplification back to a single offset fails loudly.
    expect([30, 31, 32, 33].map(androidVersionName)).toEqual([
      'Android 11', 'Android 12', 'Android 12L', 'Android 13',
    ])
  })
})
