/**
 * `device_boot` — start a device, and grant nothing.
 *
 * Booting used to be the second half of `device_request_control`, which made starting
 * a simulator wait on a human: the agent asked, the user clicked, and only then did the
 * ~20s boot begin. Those are two different questions. Turning a simulator on is no more
 * privileged than `xcrun simctl boot`, which the agent can already run from the shell;
 * being allowed to DRIVE it — to tap through someone's app, on a device that may be
 * their real phone — is the part a human has to answer.
 *
 * So this tool does exactly the cheap half and says so in its result: the device comes
 * up, nothing is bound, and the only way to reach it is still
 * `device_request_control`. Whatever the user does with that prompt, the boot is
 * already paid for by the time they see it.
 *
 * Platform-neutral: a port that cannot start a device does not implement `power`, and
 * that absence is the refusal — see `DevicePlatformPort.power`.
 */

import type { DeviceDescriptor } from '@superone/shared/device'
import type { DevicePlatformPort } from '../device/platform-port'
import { pickOfferableDevice } from './pick-device'
import { DeviceAgentError, throwIfDeviceOperationAborted } from './types'

export interface DeviceBootRequest {
  /** Handle from `device_list` — an id, or a name resolved loosely against the catalog. */
  device: string
}

/**
 * What the agent is told once the device is up.
 *
 * `controlled: false` is stated rather than left out on purpose: this tool exists
 * BECAUSE booting is not control, and the next tool the agent reaches for would
 * otherwise be `device_snapshot`, which fails with NO_DEVICE and reads as a bug.
 */
function bootedResult(device: DeviceDescriptor, alreadyRunning: boolean) {
  return {
    running: true,
    alreadyRunning,
    controlled: false,
    device: { id: device.id, name: device.name, platform: device.platformVersion },
    note: 'The device is running, but nothing is driving it yet. '
      + 'Install and launch a build with the usual shell commands, and call '
      + 'device_request_control before device_snapshot or device_act.',
  }
}

function cannotBoot(device: DeviceDescriptor): DeviceAgentError {
  return new DeviceAgentError(
    'NO_DEVICE',
    `${device.name} cannot be started from here — it is a real device, and nothing on this `
    + 'machine turns it on. Ask its owner to wake it, then call device_request_control for it.',
  )
}

export async function bootDevice(options: {
  ports: readonly DevicePlatformPort[]
  request: DeviceBootRequest
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  const { ports, request, signal } = options
  const { device, port } = await pickOfferableDevice({
    ports,
    ref: request.device,
    ...(signal ? { signal } : {}),
  })

  // Already up: hand back the same answer rather than paying for a listing round trip
  // to be told nothing happened. Cheap enough that the agent may call this defensively.
  if (device.running) return bootedResult(device, true)

  if (!port.power) throw cannotBoot(device)

  const booted = await port.power(device.id, signal)
  throwIfDeviceOperationAborted(signal)
  if (!booted) {
    throw new DeviceAgentError('NO_DEVICE', `${device.name} did not come up.`)
  }
  return bootedResult(booted, false)
}
