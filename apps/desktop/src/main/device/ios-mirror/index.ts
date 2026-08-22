import { existsSync } from 'node:fs'
import log from '../../logger'
import { MirrorDeviceManager } from './mirror-device-manager'

/** Where macOS keeps it. Its presence is the capability check — see below. */
const MIRROR_APP_PATH = '/System/Applications/iPhone Mirroring.app'

let manager: MirrorDeviceManager | null = null
let probed = false

/**
 * The mirroring manager, or null on a Mac that cannot do it.
 *
 * Capability detection is the feature flag, exactly as it is for Android: the port is
 * never constructed on a machine without the app, so the catalog is byte-identical to
 * what it was before this provider existed.
 *
 * The app being on disk is the whole test, deliberately in place of a version check.
 * iPhone Mirroring also needs Apple silicon or a T2, and Apple has already moved the
 * minimum once — the file tracks all of that without this module keeping a
 * compatibility table up to date.
 *
 * Probed once. `device_list` runs this on every refresh, and re-answering "still not a
 * Mac" forever is pure waste.
 */
export function getMirrorDeviceManager(): MirrorDeviceManager | null {
  if (probed) return manager
  probed = true
  if (process.platform !== 'darwin' || !existsSync(MIRROR_APP_PATH)) {
    log.info('[ios-mirror] iPhone Mirroring is unavailable; mirrored phones will not be offered')
    return null
  }
  manager = new MirrorDeviceManager()
  return manager
}

/**
 * Let go of the phone on the way out.
 *
 * Nothing is stopped, and that is correct: iPhone Mirroring belongs to the user and
 * may well be the window they are using themselves. Quitting the app because SuperOne
 * closed would take their phone away with it.
 */
export async function disposeMirrorDeviceManager(): Promise<void> {
  const current = manager
  manager = null
  probed = false
  if (current) await current.detach().catch(() => {})
}

export { MirrorDeviceManager } from './mirror-device-manager'
export { MirrorDevicePort } from './device-port'
export { createMirrorSurface } from './surface'
export { MIRROR_DEVICE_ID } from './mirror-device-manager'
