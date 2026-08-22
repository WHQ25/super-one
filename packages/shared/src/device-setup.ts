/**
 * How a new device GETS onto this machine — the question the device picker could not
 * answer until now.
 *
 * Distinct from `@superone/shared/device`, which describes devices that already exist.
 * This is the step before: the user has no simulator, no emulator, or no phone
 * connected, and needs to be told what to do about it.
 *
 * The honest part of this seam is `creatable`. SuperOne can genuinely make an iOS
 * simulator — `simctl create` takes a model and a runtime and that is the whole job.
 * It cannot make an Android AVD: that needs a system image chosen and possibly
 * downloaded, which is Android Studio's Device Manager, not ours. Pretending both are
 * "New Device" would put the user one click from a dead end. So a setup path either
 * finishes here or says plainly where it finishes, and the menu renders the two
 * differently.
 */

/**
 * Every way a device can arrive, in the order the menu lists them.
 *
 * Ordered by how much this machine can do about it: the one SuperOne finishes itself
 * first, then the two that need another app, then the one that needs a physical phone
 * in the room.
 */
export const DEVICE_SETUP_KINDS = [
  'ios-simulator',
  'android-emulator',
  'android-phone',
  'iphone-mirroring',
] as const

export type DeviceSetupKind = (typeof DEVICE_SETUP_KINDS)[number]

/**
 * Why a path cannot be completed, when it has more than one possible reason.
 *
 * Absent is meaningful: it says the toolchain is fine and the remaining work is
 * simply not ours to do — creating an AVD, plugging in a cable, turning on a macOS
 * feature. Those get instructions, not a diagnosis.
 */
export type DeviceSetupBlocker =
  /** No usable Xcode, so `simctl` cannot create anything. */
  | 'xcode-missing'
  /** No Android SDK at all — neither adb nor the emulator. */
  | 'android-sdk-missing'
  /** adb is there but the `emulator` package is not, so AVDs cannot run. */
  | 'android-emulator-missing'
  /** iPhone Mirroring shipped in macOS 15; older systems have no such feature. */
  | 'macos-too-old'

export interface DeviceSetupOption {
  kind: DeviceSetupKind
  /**
   * Whether SuperOne finishes this itself.
   *
   * True for exactly one path today (an iOS simulator on a machine with Xcode), and
   * the menu is built so that staying true for exactly one path is not a special
   * case — a `creatable` entry opens a dialog that creates, everything else opens a
   * dialog that explains.
   */
  creatable: boolean
  blocker?: DeviceSetupBlocker
}

/**
 * Whether this kind needs the user sent somewhere outside SuperOne.
 *
 * Every non-creatable path has exactly one useful destination — a download page, a
 * settings pane, a doc — so the dialog always has one primary button and never has
 * to decide between several. The destination itself lives in the main process: a
 * renderer that could name its own URL would be an open redirect wearing a helpful
 * face.
 */
export function needsExternalStep(option: DeviceSetupOption): boolean {
  return !option.creatable
}
