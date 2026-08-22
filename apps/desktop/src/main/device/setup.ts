/**
 * What this machine can still be given, and where the user has to go to give it.
 *
 * The picker's other half. `registry.ts` answers "what devices are here"; this answers
 * "what could be here and isn't" — which is the only useful thing to say to someone
 * looking at an empty menu.
 *
 * Split into a pure `setupOptions` and an IO `probeDeviceSetup` on purpose. The
 * interesting part is entirely in the mapping — which absence produces which advice —
 * and that part is worth testing without an Xcode, an SDK, or a Mac.
 */

import { existsSync } from 'node:fs'
import { shell } from 'electron'
import {
  DEVICE_SETUP_KINDS,
  type DeviceSetupKind,
  type DeviceSetupOption,
} from '@superone/shared/device-setup'
import { adbPath, emulatorPath } from './android/adb'
import { getIosSimulatorManager } from '../ios-simulator'
import log from '../logger'

/** Where macOS keeps the iPhone Mirroring app. Absent below macOS 15. */
const IPHONE_MIRRORING_APP = '/System/Applications/iPhone Mirroring.app'

/** The usual install location. Checked, never assumed — see `destinationFor`. */
const ANDROID_STUDIO_APP = '/Applications/Android Studio.app'

/**
 * The facts the advice is derived from, gathered once.
 *
 * `iphoneMirroring` is the presence of the APP rather than a macOS version check.
 * The feature also needs Apple silicon or a T2 chip, and Apple has moved the minimum
 * once already; the app being on disk is the one signal that tracks all of it without
 * this file having to keep a compatibility table up to date.
 */
export interface DeviceSetupProbe {
  /** A usable Xcode, i.e. `simctl` can create a simulator. */
  xcode: boolean
  adb: boolean
  /** The `emulator` SDK package, which is separate from platform-tools. */
  emulator: boolean
  iphoneMirroring: boolean
  macos: boolean
}

/**
 * Turn absences into advice.
 *
 * Only paths that mean something on THIS machine are returned. A Windows box gets the
 * two Android entries and nothing else — an iOS row that could only ever say "not on
 * this OS" is the kind of permanently-disabled menu item that teaches users to stop
 * reading the menu.
 *
 * Note what does NOT set a blocker: a complete Android SDK still leaves
 * `android-emulator` non-creatable, because making an AVD is Android Studio's job and
 * always will be. A blocker means "something is missing"; its absence means "nothing
 * is missing, and the rest is still not ours to do".
 */
export function setupOptions(probe: DeviceSetupProbe): DeviceSetupOption[] {
  const options: DeviceSetupOption[] = []
  if (probe.macos) {
    options.push({
      kind: 'ios-simulator',
      creatable: probe.xcode,
      ...(probe.xcode ? {} : { blocker: 'xcode-missing' as const }),
    })
  }
  options.push({
    kind: 'android-emulator',
    creatable: false,
    ...(!probe.adb
      ? { blocker: 'android-sdk-missing' as const }
      : !probe.emulator
        ? { blocker: 'android-emulator-missing' as const }
        : {}),
  })
  options.push({
    kind: 'android-phone',
    creatable: false,
    ...(probe.adb ? {} : { blocker: 'android-sdk-missing' as const }),
  })
  if (probe.macos) {
    options.push({
      kind: 'iphone-mirroring',
      creatable: false,
      ...(probe.iphoneMirroring ? {} : { blocker: 'macos-too-old' as const }),
    })
  }
  // Sorted into the canonical order rather than trusting the order they were pushed
  // in: the menu reads this array top to bottom, and a later edit that appends a new
  // kind in the wrong place should not silently reorder the menu.
  return options.sort(
    (a, b) => DEVICE_SETUP_KINDS.indexOf(a.kind) - DEVICE_SETUP_KINDS.indexOf(b.kind),
  )
}

/**
 * Where the "do it" button goes.
 *
 * Resolved in the main process, never sent to the renderer. The renderer asks to open
 * a KIND; if it could name its own URL this would be an open redirect with a helpful
 * label on it.
 *
 * An app target falls back to its download page when the app is not installed, which
 * is what makes one destination serve both "you have Android Studio, open it" and
 * "you don't, go get it" without the caller having to know which.
 */
export function destinationFor(
  option: DeviceSetupOption,
  installed: (path: string) => boolean = existsSync,
): { app: string } | { url: string } {
  switch (option.kind) {
    case 'ios-simulator':
      return { url: 'https://apps.apple.com/app/xcode/id497799835' }
    case 'android-emulator':
      return installed(ANDROID_STUDIO_APP)
        ? { app: ANDROID_STUDIO_APP }
        : { url: 'https://developer.android.com/studio' }
    case 'android-phone':
      return option.blocker === 'android-sdk-missing'
        ? { url: 'https://developer.android.com/studio' }
        : { url: 'https://developer.android.com/studio/debug/dev-options' }
    case 'iphone-mirroring':
      return option.blocker === 'macos-too-old'
        ? { url: 'https://support.apple.com/guide/mac-help/mchlbb2c87c6/mac' }
        : { app: IPHONE_MIRRORING_APP }
  }
}

export async function probeDeviceSetup(userDataPath: string): Promise<DeviceSetupOption[]> {
  const macos = process.platform === 'darwin'
  // Only on a Mac. `status()` shells out to xcode-select and simctl, and asking a
  // Windows box about them costs two failed spawns to learn what the platform check
  // already said.
  const xcode = macos
    ? await getIosSimulatorManager(userDataPath).status().then(
      (status) => status.supported,
      // A probe that throws means "no usable Xcode", which is exactly the advice this
      // file gives for `false` — there is nothing more useful to do with the error.
      () => false,
    )
    : false
  return setupOptions({
    xcode,
    adb: adbPath() !== null,
    emulator: emulatorPath() !== null,
    iphoneMirroring: macos && existsSync(IPHONE_MIRRORING_APP),
    macos,
  })
}

/**
 * Open whatever this path needs next, and report whether anything happened.
 *
 * The option is re-derived here from a fresh probe rather than trusted from the
 * renderer: the menu may have been open for a while, and an SDK installed in the
 * meantime should send the user to Device Manager rather than back to the download
 * page they already used.
 */
export async function openDeviceSetup(
  userDataPath: string,
  kind: DeviceSetupKind,
): Promise<boolean> {
  const option = (await probeDeviceSetup(userDataPath)).find((entry) => entry.kind === kind)
  if (!option) return false
  const destination = destinationFor(option)
  if ('url' in destination) {
    await shell.openExternal(destination.url)
    return true
  }
  const error = await shell.openPath(destination.app)
  if (error) log.warn('[device-setup] failed to open', destination.app, error)
  return error === ''
}
