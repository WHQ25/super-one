/**
 * Every platform this machine can actually offer, assembled once for the panel.
 *
 * The counterpart to `device-agent`'s platform-port factory, and deliberately built
 * from the same managers: the picker and the agent's `device_list` have to answer
 * with the same devices, or approving one in chat would show a different one in the
 * panel. Ports enumerate, surfaces stream — same managers underneath, two audiences.
 *
 * Order is the catalog's: the simulator first, Android after. Purely presentational
 * now — routing reads the provider off the deviceId, so nothing falls back to the
 * first surface any more — but it is still the order the picker lists devices in.
 *
 * Android is absent, not empty, on a machine with no SDK. `getAndroidDeviceManager`
 * returns null there and the surface is never built, so both the catalog and the
 * routing behave exactly as they did before Android existed.
 */

import { join } from 'node:path'
import type { DeviceDescriptor } from '@superone/shared/device'
import { getIosSimulatorManager } from '../ios-simulator'
import { createIosSimulatorSurface } from '../ios-simulator/surface'
import { IosSimulatorDevicePort } from '../ios-simulator/device-port'
import { getAndroidDeviceManager, AndroidDevicePort } from './android'
import { createAndroidSurface } from './android/surface'
import { createMirrorSurface, getMirrorDeviceManager, MirrorDevicePort } from './ios-mirror'
import { orderDevices, type DevicePlatformPort } from './platform-port'
import type { DeviceSurface } from './surface'

export function deviceSurfaces(userDataPath: string): DeviceSurface[] {
  const surfaces: DeviceSurface[] = [
    createIosSimulatorSurface(getIosSimulatorManager(userDataPath)),
  ]
  const android = getAndroidDeviceManager()
  if (android) {
    surfaces.push(createAndroidSurface(android, join(userDataPath, 'android', 'captures')))
  }
  const mirror = getMirrorDeviceManager()
  if (mirror) {
    surfaces.push(createMirrorSurface(mirror, join(userDataPath, 'ios-mirror', 'captures')))
  }
  return surfaces
}

export function devicePlatformPorts(userDataPath: string): DevicePlatformPort[] {
  const ports: DevicePlatformPort[] = [
    new IosSimulatorDevicePort(getIosSimulatorManager(userDataPath)),
  ]
  const android = getAndroidDeviceManager()
  if (android) ports.push(new AndroidDevicePort(android))
  // Last, and that ordering is the catalog's: reaching a real phone is the slowest
  // and rarest choice, so it does not belong above things that boot on demand.
  const mirror = getMirrorDeviceManager()
  if (mirror) ports.push(new MirrorDevicePort(mirror))
  return ports
}

/**
 * Every device on this machine, in one list for the picker.
 *
 * Unavailable ones are kept — the menu decides what to do with a runtime Xcode never
 * finished downloading, and dropping them here would leave it unable to tell "you
 * have none" from "yours are all broken".
 *
 * A platform that throws contributes nothing rather than emptying the list: a phone
 * whose adb went away must not take the simulators with it.
 */
export async function listAllDevices(userDataPath: string): Promise<DeviceDescriptor[]> {
  const lists = await Promise.all(
    devicePlatformPorts(userDataPath).map((port) => port.listDevices().catch(() => [])),
  )
  // Per platform, not across: the ports are already in catalog order, and one global
  // sort would interleave phones with simulators for no reason the user asked for.
  return lists.flatMap((devices) => orderDevices(devices))
}
