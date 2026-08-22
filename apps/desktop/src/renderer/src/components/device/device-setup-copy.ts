/**
 * Which paragraph a setup path gets.
 *
 * Pulled out of the dialog because the interesting part is the mapping, not the
 * rendering: "no SDK at all" and "adb but no emulator" want opposite instructions,
 * and getting that pairing wrong is invisible in a screenshot — the dialog looks
 * perfectly fine while telling the user to install something they already have.
 */

import type { DeviceSetupKind, DeviceSetupOption } from '@superone/shared/device-setup'

const ROOT = 'activity.device.setup'

/** Kind → the i18n group that holds its label and its advice. */
const GROUPS: Record<DeviceSetupKind, string> = {
  'ios-simulator': 'iosSimulator',
  'android-emulator': 'androidEmulator',
  'android-phone': 'androidPhone',
  'iphone-mirroring': 'iphoneMirroring',
}

export function labelKey(kind: DeviceSetupKind): string {
  return `${ROOT}.${GROUPS[kind]}.label`
}

/**
 * The advice block for this option, or null when there is nothing to advise.
 *
 * Null means the path finishes inside SuperOne — today only an iOS simulator on a
 * machine with Xcode — and the caller should open the creation dialog instead. Every
 * other combination resolves, so the dialog never has to render an empty state.
 */
export function adviceKey(option: DeviceSetupOption): string | null {
  if (option.creatable) return null
  const group = `${ROOT}.${GROUPS[option.kind]}`
  switch (option.blocker) {
    case 'xcode-missing': return `${group}.xcodeMissing`
    case 'android-sdk-missing': return `${group}.sdkMissing`
    case 'android-emulator-missing': return `${group}.emulatorMissing`
    case 'macos-too-old': return `${group}.tooOld`
    // No blocker: the toolchain is fine and the remaining work is simply not ours.
    default: return `${group}.ready`
  }
}

/** `body` is newline-separated so a translator can re-order its sentences. */
export function adviceSteps(body: string): string[] {
  return body.split('\n').map((line) => line.trim()).filter(Boolean)
}
