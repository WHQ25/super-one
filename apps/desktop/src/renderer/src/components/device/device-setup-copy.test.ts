import { describe, expect, it } from 'vitest'
import { DEVICE_SETUP_KINDS, type DeviceSetupOption } from '@superone/shared/device-setup'
import { en } from '@superone/shared/i18n/en'
import { zh } from '@superone/shared/i18n/zh'
import { adviceKey, adviceSteps, labelKey } from './device-setup-copy'

/** Walk a dotted i18n path, so a stale key fails here instead of rendering raw. */
function lookup(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, part) => (node as Record<string, unknown> | undefined)?.[part],
    messages,
  )
}

describe('device setup copy', () => {
  it('resolves a label for every kind, in both locales', () => {
    for (const kind of DEVICE_SETUP_KINDS) {
      expect(lookup(en, labelKey(kind)), `en ${kind}`).toEqual(expect.any(String))
      expect(lookup(zh, labelKey(kind)), `zh ${kind}`).toEqual(expect.any(String))
    }
  })

  it('sends a creatable path to the creation dialog rather than to advice', () => {
    expect(adviceKey({ kind: 'ios-simulator', creatable: true })).toBeNull()
  })

  it('resolves advice for every blocker a kind can actually report', () => {
    // Paired the way `setupOptions` pairs them — a mapping that resolves to a real
    // string but the WRONG one is exactly the bug this file exists to prevent.
    const cases: Array<{ option: DeviceSetupOption; tail: string }> = [
      { option: { kind: 'ios-simulator', creatable: false, blocker: 'xcode-missing' }, tail: 'iosSimulator.xcodeMissing' },
      { option: { kind: 'android-emulator', creatable: false }, tail: 'androidEmulator.ready' },
      { option: { kind: 'android-emulator', creatable: false, blocker: 'android-sdk-missing' }, tail: 'androidEmulator.sdkMissing' },
      { option: { kind: 'android-emulator', creatable: false, blocker: 'android-emulator-missing' }, tail: 'androidEmulator.emulatorMissing' },
      { option: { kind: 'android-phone', creatable: false }, tail: 'androidPhone.ready' },
      { option: { kind: 'android-phone', creatable: false, blocker: 'android-sdk-missing' }, tail: 'androidPhone.sdkMissing' },
      { option: { kind: 'iphone-mirroring', creatable: false }, tail: 'iphoneMirroring.ready' },
      { option: { kind: 'iphone-mirroring', creatable: false, blocker: 'macos-too-old' }, tail: 'iphoneMirroring.tooOld' },
    ]

    for (const { option, tail } of cases) {
      const key = adviceKey(option)
      expect(key, `${option.kind}/${option.blocker ?? 'none'}`).toBe(`activity.device.setup.${tail}`)
      for (const [name, messages] of [['en', en], ['zh', zh]] as const) {
        const advice = lookup(messages, key!) as Record<string, string> | undefined
        expect(advice, `${name} ${tail}`).toMatchObject({
          title: expect.any(String),
          body: expect.any(String),
          action: expect.any(String),
        })
      }
    }
  })

  it('splits a body into steps and drops the blank lines', () => {
    expect(adviceSteps('First step.\n\n  Second step.  \n')).toEqual(['First step.', 'Second step.'])
  })
})
