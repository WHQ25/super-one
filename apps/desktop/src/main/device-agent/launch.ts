/**
 * `device_request_launch` — ask the user for a device, then attach this session to it.
 *
 * The rest of the device tools refuse to run until a simulator is bound to the chat
 * session, and binding was reachable only from the Activity panel. That left the agent
 * able to install an app with `simctl` and then unable to see it. This closes the gap
 * without giving the agent the device unasked: the host resolves what is actually
 * available, the user picks and approves, and only then does the session bind.
 */

import type {
  DeviceLaunchCandidate,
  DeviceLaunchConfirmPayload,
} from '@superone/shared/agent-types'
import type { IosSimulatorDevice, IosSimulatorSessionState } from '@superone/shared/ios-simulator'
import { awaitDeviceLaunchConfirm } from './launch-confirm'
import { DeviceAgentError, throwIfDeviceOperationAborted } from './types'

/** The slice of `IosSimulatorManager` this flow needs, so tests need no Electron. */
export interface DeviceLaunchPort {
  listDevices(): Promise<IosSimulatorDevice[]>
  getSessionState(sessionId: string): Promise<IosSimulatorSessionState>
  boot(sessionId: string, udid: string): Promise<IosSimulatorSessionState>
}

export interface DeviceLaunchRequest {
  /** Free text from the agent naming the device it wants, e.g. "iPhone 17 Pro Max". */
  device?: string
  /** Why it needs one — shown to the user, so it is the whole justification they get. */
  reason?: string
}

function describe(device: IosSimulatorDevice): DeviceLaunchCandidate {
  return {
    id: device.udid,
    name: device.name,
    platform: device.runtimeName,
    running: device.booted,
    ...(device.boundSessionId ? { busy: true } : {}),
  }
}

/**
 * Running devices first, then by name.
 *
 * Not cosmetic: approving a running simulator only attaches, while approving a cold
 * one spends ~20s booting. Putting the cheap choice at the top of the list is the
 * difference between the default answer being free and the default answer being a wait.
 */
function orderCandidates(devices: IosSimulatorDevice[]): IosSimulatorDevice[] {
  return [...devices].sort((a, b) => {
    if (a.booted !== b.booted) return a.booted ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Resolve the agent's free-text ask against the catalog.
 *
 * Matched loosely on purpose. The agent is writing from what the user said in chat
 * ("the 17 Pro Max", "an iPad") rather than reading a device list, so an exact-match
 * rule would reject nearly every real ask — and the cost of a loose match is only
 * which row starts selected in a prompt the user still has to approve.
 */
function resolvePreference(
  devices: IosSimulatorDevice[],
  preference: string | undefined,
): IosSimulatorDevice | null {
  if (!preference) return null
  const needle = preference.trim().toLowerCase()
  if (!needle) return null
  const exact = devices.find((device) => device.udid.toLowerCase() === needle)
  if (exact) return exact
  const byName = devices.find((device) => device.name.toLowerCase() === needle)
  if (byName) return byName
  return devices.find((device) => {
    const haystack = `${device.name} ${device.runtimeName}`.toLowerCase()
    return haystack.includes(needle) || needle.includes(device.name.toLowerCase())
  }) ?? null
}

function readyResult(state: IosSimulatorSessionState, alreadyConnected: boolean) {
  return {
    connected: true,
    alreadyConnected,
    device: state.device
      ? {
          id: state.device.udid,
          name: state.device.name,
          platform: state.device.runtimeName,
        }
      : null,
    note: 'The device is bound to this session. Install a build with `xcrun simctl install <udid> <path/to/.app>` '
      + 'and launch it with `xcrun simctl launch <udid> <bundle-id>`, then use device_snapshot to see the screen. '
      // The user is already watching this device here, so a command whose ONLY effect
      // is to show Apple's Simulator window is pure duplication -- and one that merely
      // un-hides an app the host had hidden is not something the host can quietly undo.
      // Scoped to exactly those two: build-and-run commands (`flutter run`,
      // `expo run:ios`) are real work and stay allowed, and neither of them puts a
      // window up that this app cannot deal with on its own.
      + 'The device is already booted and visible in this session, so never run a command whose only '
      + 'job is to show Apple\'s Simulator window — no `open -a Simulator`, no `flutter emulators --launch`. '
      + 'Build-and-run commands are fine.',
  }
}

export async function requestDeviceLaunch(options: {
  sessionId: string
  port: DeviceLaunchPort
  emitHostEvent: ((event: import('@superone/shared/agent-types').AgentEvent) => void) | null
  request: DeviceLaunchRequest
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  const { sessionId, port, request, signal } = options
  throwIfDeviceOperationAborted(signal)

  const current = await port.getSessionState(sessionId)
  const bound = current.phase === 'ready' ? current.device : null
  // Already holding a device, and not being asked for a different one: hand back the
  // same answer rather than a second prompt for something the user already granted.
  if (bound && !resolvesElsewhere(bound, request.device)) return readyResult(current, true)

  const devices = await port.listDevices()
  throwIfDeviceOperationAborted(signal)
  const offerable = orderCandidates(devices.filter((device) => device.available))
  if (offerable.length === 0) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      devices.length === 0
        ? 'No simulators exist on this machine. Create one in Xcode (or the Activity panel) first.'
        : 'Every simulator on this machine is unavailable — its runtime is probably not installed.',
    )
  }

  const suggested = resolvePreference(offerable, request.device) ?? offerable[0]!
  const payload: DeviceLaunchConfirmPayload = {
    ...(request.reason ? { reason: request.reason } : {}),
    candidates: offerable.map(describe),
    suggestedId: suggested.udid,
  }

  if (!options.emitHostEvent) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      'This session cannot ask for approval right now, so no device can be handed over.',
    )
  }

  const decision = await awaitDeviceLaunchConfirm({
    emitHostEvent: options.emitHostEvent,
    payload,
    message: request.reason
      ? `Let the agent use a device? ${request.reason}`
      : 'Let the agent use a device?',
    ...(signal ? { signal } : {}),
  })

  if (decision.action !== 'accept') {
    throw new DeviceAgentError(
      'NO_DEVICE',
      decision.action === 'cancel'
        ? 'The device request was cancelled.'
        : 'The user declined to hand over a device. Do not ask again unless they bring it up.',
    )
  }

  const chosen = offerable.find((device) => device.udid === decision.deviceId)
  if (!chosen) {
    throw new DeviceAgentError('NO_DEVICE', 'The approved device is no longer in the list.')
  }

  const state = await port.boot(sessionId, chosen.udid)
  if (state.phase !== 'ready' || !state.device) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      `${chosen.name} was approved but did not come up (phase=${state.phase}).`,
    )
  }
  return readyResult(state, false)
}

/** Is the agent asking for a device other than the one already bound? */
function resolvesElsewhere(bound: IosSimulatorDevice, preference: string | undefined): boolean {
  if (!preference) return false
  return resolvePreference([bound], preference) === null
}
