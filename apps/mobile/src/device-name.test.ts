import { describe, expect, it } from 'vitest'
import { resolveMobileDeviceName } from './device-name'

describe('resolveMobileDeviceName', () => {
  it('uses the iOS user-assigned name', () => {
    expect(resolveMobileDeviceName({
      deviceName: "Hangqi's iPhone",
      os: 'ios',
    })).toBe("Hangqi's iPhone")
  })

  it('falls back to iPhone when iOS has no assigned name', () => {
    expect(resolveMobileDeviceName({ os: 'ios' })).toBe('iPhone')
  })

  it('composes Android brand and model like the Flutter client', () => {
    expect(resolveMobileDeviceName({
      deviceName: 'SM-S911B',
      brand: 'samsung',
      os: 'android',
    })).toBe('Samsung SM-S911B')
  })

  it('prefixes a capitalized Android brand onto the model', () => {
    expect(resolveMobileDeviceName({
      deviceName: 'Pixel 8',
      brand: 'google',
      os: 'android',
    })).toBe('Google Pixel 8')
  })

  it('does not duplicate an Android model that already includes the brand', () => {
    expect(resolveMobileDeviceName({
      deviceName: 'Google Pixel 8',
      brand: 'google',
      os: 'android',
    })).toBe('Google Pixel 8')
  })

  it('uses the Android model alone when brand is missing', () => {
    expect(resolveMobileDeviceName({
      deviceName: 'Pixel 8',
      os: 'android',
    })).toBe('Pixel 8')
  })

  it('falls back to Android when nothing is known', () => {
    expect(resolveMobileDeviceName({ os: 'android' })).toBe('Android')
  })

  it('trims whitespace and ignores empty names', () => {
    expect(resolveMobileDeviceName({ deviceName: '  ', os: 'ios' })).toBe('iPhone')
  })

  it('falls back to Mobile off native platforms', () => {
    expect(resolveMobileDeviceName({ os: 'web' })).toBe('Mobile')
  })
})
