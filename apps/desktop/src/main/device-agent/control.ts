/**
 * `device_request_control` — ask the user to hand this session control of one device.
 *
 * The rest of the device tools refuse to run until a simulator is bound to the chat
 * session, and binding was reachable only from the Activity panel. That left the agent
 * able to install an app with `simctl` and then unable to see it.
 *
 * This tool is only about the grant. Booting a simulator and launching a build are
 * both plain `simctl` work the agent can already do from Bash, so the prompt asks one
 * question — may this session drive *this* device — and the agent picks the device
 * from `device_list` beforehand rather than making the user shop inside a dialog.
 */

import { awaitDeviceControlConfirm } from './control-confirm'
import { offerableDevices, resolveDevice, type DeviceCatalogPort } from './device-catalog'
import { NO_DEVICE_RECENTS, type DeviceRecentsPort } from './device-recents'
import type { IosSimulatorSessionState } from '@superone/shared/ios-simulator'
import { DeviceAgentError, throwIfDeviceOperationAborted } from './types'

export interface DeviceControlRequest {
  /** Handle from `device_list` — a udid, or a name resolved loosely against the catalog. */
  device: string
  /** Why it needs one — shown to the user, so it is the whole justification they get. */
  reason?: string
}

function readyResult(state: IosSimulatorSessionState, alreadyControlled: boolean) {
  return {
    controlled: true,
    alreadyControlled,
    device: state.device
      ? {
          id: state.device.udid,
          name: state.device.name,
          platform: state.device.runtimeName,
        }
      : null,
    note: 'This session now controls the device. Install a build with `xcrun simctl install <udid> <path/to/.app>` '
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

export async function requestDeviceControl(options: {
  sessionId: string
  port: DeviceCatalogPort
  emitHostEvent: ((event: import('@superone/shared/agent-types').AgentEvent) => void) | null
  request: DeviceControlRequest
  /** Where the grant is recorded, so `device_list` can offer it first next time. */
  recents?: DeviceRecentsPort
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  const { sessionId, port, request, signal, recents = NO_DEVICE_RECENTS } = options
  throwIfDeviceOperationAborted(signal)

  const devices = await port.listDevices()
  throwIfDeviceOperationAborted(signal)
  const offerable = offerableDevices(devices)
  if (offerable.length === 0) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      devices.length === 0
        ? 'No simulators exist on this machine. Create one in Xcode (or the Activity panel) first.'
        : 'Every simulator on this machine is unavailable — its runtime is probably not installed.',
    )
  }

  const chosen = resolveDevice(offerable, request.device)
  if (!chosen) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      `No available device matches "${request.device}". Call device_list and quote an id from it.`,
    )
  }

  // Already holding exactly this device: hand back the same answer rather than a
  // second prompt for something the user already granted.
  const current = await port.getSessionState(sessionId, devices)
  if (current.phase === 'ready' && current.device?.udid === chosen.udid) {
    recents.remember(chosen.udid)
    return readyResult(current, true)
  }

  if (!options.emitHostEvent) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      'This session cannot ask for approval right now, so no device can be handed over.',
    )
  }

  // Taking a device another chat holds is allowed, but it unbinds that session — so
  // it is said out loud rather than discovered afterwards by whoever was using it.
  const takenFrom = chosen.boundSessionId && chosen.boundSessionId !== sessionId
    ? ' It is currently controlled by another chat session, which will lose it.'
    : ''
  const subject = `${chosen.name} (${chosen.runtimeName})`
  const decision = await awaitDeviceControlConfirm({
    emitHostEvent: options.emitHostEvent,
    deviceName: chosen.name,
    platform: chosen.runtimeName,
    ...(request.reason ? { reason: request.reason } : {}),
    message: request.reason
      ? `Let the agent control ${subject}? ${request.reason}${takenFrom}`
      : `Let the agent control ${subject}?${takenFrom}`,
    ...(signal ? { signal } : {}),
  })

  if (decision.action !== 'accept') {
    // The user's typed feedback is the whole point of denying through the standard
    // prompt — "use the iPad instead" arrives here, and dropping it would leave the
    // agent guessing at a refusal the user already explained.
    const feedback = decision.reason ? ` They said: ${decision.reason}` : ''
    throw new DeviceAgentError(
      'DECLINED',
      decision.action === 'cancel'
        ? `The device request was cancelled.${feedback}`
        : `The user declined to hand over ${chosen.name}.${feedback} `
          + 'Do not ask again unless they bring it up or their feedback names another device.',
    )
  }

  const state = await port.boot(sessionId, chosen.udid)
  if (state.phase !== 'ready' || !state.device) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      `${chosen.name} was approved but did not come up (phase=${state.phase}).`,
    )
  }
  // Recorded only once the device is actually in hand: a declined or failed request
  // is not something the next `device_list` should recommend.
  recents.remember(chosen.udid)
  return readyResult(state, false)
}
