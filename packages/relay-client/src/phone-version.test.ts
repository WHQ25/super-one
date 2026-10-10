import { describe, expect, it } from 'vitest'
import { MIN_PHONE_DESKTOP_VERSION, requirePhoneDesktop } from './phone-version'

describe('concrete phone desktop release floor', () => {
  it.each(['0.72.2', '0.73.0-alpha', '0.73.0-alpha.0', '0.73.0-alpha.01', '0.73.0-', '0.73.0+'])('requires an upgrade for %s', appVersion => {
    expect(() => requirePhoneDesktop({ appVersion, protocol: 3, environmentId: 'desk' })).toThrow(MIN_PHONE_DESKTOP_VERSION)
  })
  it.each([MIN_PHONE_DESKTOP_VERSION, '0.73.0-alpha.2', '0.73.0-alpha.10+build.2', '0.73.0', '0.74.0-alpha'])('accepts %s when its native contract is present', appVersion => {
    expect(() => requirePhoneDesktop({ appVersion, protocol: 3, environmentId: 'desk' })).not.toThrow()
  })
  it('requires both the concrete release and a valid native host contract', () => {
    for (const host of [undefined, { appVersion: '0.74.0', protocol: 2, environmentId: 'desk' }, { appVersion: '0.74.0', protocol: 3, environmentId: '' }]) expect(() => requirePhoneDesktop(host)).toThrow(MIN_PHONE_DESKTOP_VERSION)
  })
})
