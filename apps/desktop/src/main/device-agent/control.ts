/**
 * `device_request_control` — ask the user to hand this session control of one device.
 *
 * The rest of the device tools refuse to run until a device is bound to the chat
 * session, and binding was reachable only from the Activity panel. That left the agent
 * able to install an app from the shell and then unable to see it.
 *
 * This tool is only about the grant. Booting a device and launching a build are both
 * plain shell work the agent can already do, so the prompt asks one question — may
 * this session drive *this* device — and the agent picks the device from
 * `device_list` beforehand rather than making the user shop inside a dialog.
 *
 * Platform-neutral throughout: which shell commands to recommend afterwards is the
 * one genuinely platform-specific part, and each port supplies its own (see
 * `DevicePlatformPort.controlNote`).
 */

import type { DeviceDescriptor } from '@superone/shared/device'
import { offerableDevices, resolveDevice, type DevicePlatformPort } from '../device/platform-port'
import { awaitDeviceControlConfirm } from './control-confirm'
import { NO_DEVICE_RECENTS, type DeviceRecentsPort } from './device-recents'
import { DeviceAgentError, throwIfDeviceOperationAborted } from './types'

export interface DeviceControlRequest {
  /** Handle from `device_list` — an id, or a name resolved loosely against the catalog. */
  device: string
  /** Why it needs one — shown to the user, so it is the whole justification they get. */
  reason?: string
}

function readyResult(
  device: DeviceDescriptor,
  port: DevicePlatformPort,
  alreadyControlled: boolean,
) {
  return {
    controlled: true,
    alreadyControlled,
    device: { id: device.id, name: device.name, platform: device.platformVersion },
    note: port.controlNote(device),
  }
}

function portFor(
  ports: readonly DevicePlatformPort[],
  device: DeviceDescriptor,
): DevicePlatformPort {
  const port = ports.find((candidate) => candidate.platform === device.platform)
  if (!port) {
    // Unreachable while every descriptor came from a port in this same list, which is
    // the only way one is ever produced. Named rather than non-null-asserted so a
    // future caller that assembles the two separately fails loudly here.
    throw new DeviceAgentError('NO_DEVICE', `No backend is registered for ${device.platform}.`)
  }
  return port
}

export async function requestDeviceControl(options: {
  sessionId: string
  ports: readonly DevicePlatformPort[]
  emitHostEvent: ((event: import('@superone/shared/agent-types').AgentEvent) => void) | null
  request: DeviceControlRequest
  /** Where the grant is recorded, so `device_list` can offer it first next time. */
  recents?: DeviceRecentsPort
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  const { sessionId, ports, request, signal, recents = NO_DEVICE_RECENTS } = options
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

  const chosen = resolveDevice(offerable, request.device)
  if (!chosen) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      `No available device matches "${request.device}". Call device_list and quote an id from it.`,
    )
  }
  const port = portFor(ports, chosen)

  // Already holding exactly this device: hand back the same answer rather than a
  // second prompt for something the user already granted.
  //
  // Handed the devices we just listed, which is not a micro-optimization: a port asked
  // without them enumerates the machine again — a second `simctl list devices` or
  // `adb devices` spawn — for a catalog it was given a moment ago.
  const current = await port.controlled(
    sessionId,
    all.filter((device) => device.platform === port.platform),
  )
  if (current?.id === chosen.id) {
    recents.remember(chosen.id)
    return readyResult(current, port, true)
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
  const subject = `${chosen.name} (${chosen.platformVersion})`
  const decision = await awaitDeviceControlConfirm({
    emitHostEvent: options.emitHostEvent,
    deviceName: chosen.name,
    platform: chosen.platformVersion,
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

  const booted = await port.boot(sessionId, chosen.id)
  if (!booted) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      `${chosen.name} was approved but did not come up.`,
    )
  }
  // Recorded only once the device is actually in hand: a declined or failed request
  // is not something the next `device_list` should recommend.
  recents.remember(booted.id)
  return readyResult(booted, port, false)
}
