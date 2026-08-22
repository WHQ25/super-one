import log from '../../logger'
import { AndroidDeviceManager, detectAndroidToolchain } from './android-device-manager'

let manager: AndroidDeviceManager | null = null
let probed = false

/**
 * The Android manager, or null on a machine with no SDK.
 *
 * Null is the ordinary answer, not a failure: most machines running this app have no
 * Android SDK, and on those the Android port is simply never registered — the catalog
 * stays single-platform and its output is unchanged. Capability detection is the
 * feature flag.
 *
 * Probed once. `existsSync` against three candidate paths is cheap, but this is called
 * on every `device_list`, and re-answering "still no SDK" forever is pure waste.
 */
export function getAndroidDeviceManager(): AndroidDeviceManager | null {
  if (probed) return manager
  probed = true
  const toolchain = detectAndroidToolchain()
  if (!toolchain) {
    log.info('[android] no SDK found; Android devices will not be offered')
    return null
  }
  manager = new AndroidDeviceManager(toolchain)
  return manager
}

export async function disposeAndroidDeviceManager(): Promise<void> {
  const current = manager
  manager = null
  probed = false
  await current?.dispose()
}

export { AndroidDeviceManager } from './android-device-manager'
export { AndroidDevicePort } from './device-port'
