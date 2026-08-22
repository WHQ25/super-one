import type { DeviceDescriptor } from '@superone/shared/device'
import { readRecentDeviceIds, resolveRecentDevices } from './device-recents'

/**
 * What a freshly opened device tab should point at before the user says anything.
 *
 * Running first, remembered second. A device that is already up costs nothing to
 * attach to and is almost always the one being worked on; a remembered one still has
 * to be launched, so it is a weaker guess and only worth making when nothing is
 * running. An empty answer is a perfectly good outcome — the tab opens on its picker.
 *
 * Both bands skip anything already spoken for, in either of the two ways a device can
 * be: OWNED by another chat session (`boundSessionId`), or merely POINTED at by
 * another tab of this one. The second is the reason this takes `taken` at all —
 * a device that is drawn but not yet booted carries no ownership for the host to
 * report, and two tabs opening onto the same shut-down simulator is a pair the user
 * has no way to tell apart.
 *
 * This does not claim anything. The caller decides what to do with the answer, and
 * only steps into a device that is running AND unowned — see `DevicePanel.preview`.
 */
export function pickDefaultDevice(
  devices: DeviceDescriptor[],
  sessionId: string,
  taken: readonly string[],
): DeviceDescriptor | null {
  const spokenFor = new Set(taken)
  const free = (device: DeviceDescriptor): boolean =>
    device.available
    && !spokenFor.has(device.id)
    && (!device.boundSessionId || device.boundSessionId === sessionId)

  const running = devices.find((device) => device.running && free(device))
  if (running) return running
  return resolveRecentDevices(readRecentDeviceIds(), devices).find(free) ?? null
}
