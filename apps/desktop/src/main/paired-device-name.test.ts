import { describe, expect, it } from 'vitest'
import { PAIRED_DEVICE_NAME_MAX, resolvePairedDeviceDisplayName } from './paired-device-name'

describe('resolvePairedDeviceDisplayName', () => {
  it('prefers the edited name', () => {
    expect(resolvePairedDeviceDisplayName("Hangqi's iPhone", 'iPhone')).toBe("Hangqi's iPhone")
  })

  it('falls back to the phone suggestion when the field is empty', () => {
    expect(resolvePairedDeviceDisplayName('   ', 'Google Pixel 8')).toBe('Google Pixel 8')
  })

  it('collapses whitespace and caps length', () => {
    expect(resolvePairedDeviceDisplayName('  Kitchen   Pixel  ', 'x')).toBe('Kitchen Pixel')
    expect(resolvePairedDeviceDisplayName('a'.repeat(80), 'x').length).toBe(PAIRED_DEVICE_NAME_MAX)
  })

  it('uses Mobile Device when nothing usable remains', () => {
    expect(resolvePairedDeviceDisplayName('', '  ')).toBe('Mobile Device')
  })
})
