/**
 * `device_release` — the agent is done with a device, so let go of it.
 *
 * The counterpart of `device_request_control`, and the tool that was missing: every
 * run used to end with the agent walking away from a simulator it booted, still
 * running, still bound, burning CPU until the user noticed the panel. This is the
 * browser's close-tab for phones.
 *
 * What "let go" means is the port's decision, because it differs per platform — a
 * simulator this app booted is shut down, one the user had open is merely unbound, a
 * real phone is only ever unbound. `shutdown` forces the stop on anything that can
 * stop. Here the shared part happens: which of the session's devices was meant, the
 * put-back rule is invoked, and the result names both what happened and what the
 * agent should now expect from the other tools.
 */

import { parseDeviceId } from '@superone/shared/device'
import { portFor, type DevicePlatformPort, type DeviceReleaseOutcome } from '../device/platform-port'
import { resolveHeldDevice, type HeldDevice } from './target'
import { DeviceAgentError, throwIfDeviceOperationAborted } from './types'

export interface DeviceReleaseRequest {
  /** Which of the session's devices. Optional while it holds exactly one. */
  device?: string
  /** Stop the device even if it was running before this session found it. */
  shutdown?: boolean
}

export interface DeviceReleaseResult {
  released: true
  outcome: DeviceReleaseOutcome
  /** Whether the device is still up — a detached one can be re-granted with no boot. */
  running: boolean
  device: { id: string; name?: string }
  note: string
}

/**
 * What the agent is told once the device is gone.
 *
 * `running` is stated because it is the thing the agent will act on next: a device
 * left running can be re-granted instantly, one that was shut down costs a boot. The
 * note owns a forced shutdown that did not happen — a real phone — rather than let
 * `released: true` stand for "it is off now".
 */
function releasedResult(
  device: HeldDevice,
  outcome: DeviceReleaseOutcome,
  forced: boolean,
): DeviceReleaseResult {
  const name = device.name ?? device.id
  const note = outcome === 'shutdown'
    ? `${name} is shut down and no longer controlled by this session. `
      + 'Every other device_* tool now fails with NO_DEVICE for it; device_boot then '
      + 'device_request_control bring it back.'
    : forced
      ? `${name} is disconnected but still running: it is a real device and cannot be turned off `
        + 'from here. This session no longer controls it; device_request_control grants it again.'
      : `${name} is disconnected but still running — it was already up before this session, `
        + 'so it was left that way. This session no longer controls it; device_request_control '
        + 'grants it again with no boot wait, or pass shutdown: true to stop it too.'
  return {
    released: true,
    outcome,
    running: outcome !== 'shutdown',
    device: { id: device.id, ...(device.name ? { name: device.name } : {}) },
    note,
  }
}

export async function releaseDevice(options: {
  ports: readonly DevicePlatformPort[]
  /** Every device the session holds, from the ownership maps. */
  held: readonly HeldDevice[]
  request: DeviceReleaseRequest
  signal?: AbortSignal
}): Promise<DeviceReleaseResult> {
  const { ports, held, request, signal } = options
  throwIfDeviceOperationAborted(signal)

  const deviceId = resolveHeldDevice(held, request.device)
  const device = held.find((candidate) => candidate.id === deviceId) ?? { id: deviceId }

  const provider = parseDeviceId(deviceId)?.provider
  const port = provider ? portFor(ports, { provider }) : null
  if (!port) {
    throw new DeviceAgentError('NO_DEVICE', `No backend is registered for ${deviceId}.`)
  }

  const shutdown = request.shutdown === true
  const outcome = await port.release(deviceId, { shutdown })
  return releasedResult(device, outcome, shutdown)
}
