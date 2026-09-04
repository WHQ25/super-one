/**
 * Turning the handle the agent quoted into one device and the port that speaks for it.
 *
 * Shared by the two tools that take a device by name from outside the session's own
 * holdings — `device_boot` and `device_request_control`. They ask the same three
 * questions in the same order (is there anything to offer, does this handle match one
 * of them, which platform is it), and each answer is a message the agent has to be able
 * to act on, so they are written once here rather than twice with drifting wording.
 */

import type { DeviceDescriptor } from '@superone/shared/device'
import {
  offerableDevices,
  portFor,
  resolveDevice,
  type DevicePlatformPort,
} from '../device/platform-port'
import { DeviceAgentError, throwIfDeviceOperationAborted } from './types'

export interface PickedDevice {
  device: DeviceDescriptor
  port: DevicePlatformPort
  /** Every device every port listed, so callers need not enumerate the machine twice. */
  all: DeviceDescriptor[]
}

export async function pickOfferableDevice(options: {
  ports: readonly DevicePlatformPort[]
  /** An id from `device_list`, or a name matched loosely against the catalog. */
  ref: string
  signal?: AbortSignal
}): Promise<PickedDevice> {
  const { ports, ref, signal } = options
  throwIfDeviceOperationAborted(signal)

  const all: DeviceDescriptor[] = []
  for (const port of ports) {
    all.push(...await port.listDevices())
    throwIfDeviceOperationAborted(signal)
  }

  const offerable = offerableDevices(all)
  if (offerable.length === 0) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      ports.map((port) => port.emptyNote(all.length)).join(' '),
    )
  }

  const device = resolveDevice(offerable, ref)
  if (!device) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      `No available device matches "${ref}". Call device_list and quote an id from it.`,
    )
  }

  const port = portFor(ports, device)
  if (!port) {
    throw new DeviceAgentError('NO_DEVICE', `No backend is registered for ${device.platform}.`)
  }
  return { device, port, all }
}
