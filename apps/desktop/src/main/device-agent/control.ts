/**
 * `device_request_control` — ask the user to hand this session control of one device.
 *
 * The rest of the device tools refuse to run until a device is bound to the chat
 * session, and binding was reachable only from the Activity panel. That left the agent
 * able to install an app from the shell and then unable to see it.
 *
 * This tool is only about the grant. Starting a device is `device_boot`, and launching
 * a build is plain shell work the agent can already do, so the prompt asks one question
 * — may this session drive *this* device — and the agent picks the device from
 * `device_list` beforehand rather than making the user shop inside a dialog.
 *
 * The prompt offers two answers, and they differ in lifetime rather than in reach:
 * this chat only (the default — the binding dies with the session, so nothing is
 * stored), or from now on for every session, recorded per device in
 * `device-grants.ts`. Per device, not blanket: approving a simulator must not silently
 * approve the real phone on the desk.
 *
 * Platform-neutral throughout: which shell commands to recommend afterwards is the
 * one genuinely platform-specific part, and each port supplies its own (see
 * `DevicePlatformPort.controlNote`).
 */

import type { DeviceDescriptor } from '@superone/shared/device'
import { controlledDevices, type DevicePlatformPort } from '../device/platform-port'
import { awaitDeviceControlConfirm } from './control-confirm'
import { NO_DEVICE_GRANTS, type DeviceGrantsPort } from './device-grants'
import { NO_DEVICE_RECENTS, type DeviceRecentsPort } from './device-recents'
import { pickOfferableDevice } from './pick-device'
import { DeviceAgentError } from './types'

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

async function waitForPreview(
  device: DeviceDescriptor,
  port: DevicePlatformPort,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await port.waitForPreview(device.id, signal)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new DeviceAgentError(
      'NO_DEVICE',
      `${device.name} is under control, but its live preview is not ready: ${detail}`,
    )
  }
}

export async function requestDeviceControl(options: {
  sessionId: string
  ports: readonly DevicePlatformPort[]
  emitHostEvent: ((event: import('@superone/shared/agent-types').AgentEvent) => void) | null
  request: DeviceControlRequest
  /** Where the grant is recorded, so `device_list` can offer it first next time. */
  recents?: DeviceRecentsPort
  /** Standing approvals, and where a new "always" one is written. */
  grants?: DeviceGrantsPort
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  const {
    sessionId,
    ports,
    request,
    signal,
    recents = NO_DEVICE_RECENTS,
    grants = NO_DEVICE_GRANTS,
  } = options

  const { device: chosen, port, all } = await pickOfferableDevice({
    ports,
    ref: request.device,
    ...(signal ? { signal } : {}),
  })

  // Already holding exactly this device: hand back the same answer rather than a
  // second prompt for something the user already granted.
  //
  // Read off the listing `pickOfferableDevice` already did, which is not a
  // micro-optimization: ownership is stamped onto each row as it is built, so asking a
  // port separately would only spawn `simctl list` / `adb devices` again to be told
  // what is already in hand.
  const current = controlledDevices(all, sessionId).find((device) => device.id === chosen.id)
  if (current) {
    await waitForPreview(current, port, signal)
    recents.remember(chosen.id)
    return readyResult(current, port, true)
  }

  // A standing grant answers the prompt before it is raised. Keyed on this device, so
  // a different one still asks — but not on this session or this project, because a
  // grant that lapsed at either boundary would re-ask for the same simulator the next
  // time the user opened it from a different folder, which is the whole friction the
  // standing answer removes. Taking it off a sibling chat is covered too: an "always"
  // that stops meaning always is worse than one more click.
  if (!grants.isGranted(chosen.id)) {
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

    // Written before the boot, unlike recents: this records what the USER decided, and
    // that decision stands whether or not the device then comes up. Re-asking because
    // a simulator failed to start would be asking about the wrong thing. A plain accept
    // writes nothing — its scope is the binding below, which the session already owns.
    if (decision.alwaysAllow) {
      grants.grant({
        id: chosen.id,
        name: chosen.name,
        ...(chosen.platformVersion ? { platformVersion: chosen.platformVersion } : {}),
      })
    }
  }

  const booted = await port.boot(sessionId, chosen.id)
  if (!booted) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      `${chosen.name} was approved but did not come up.`,
    )
  }
  await waitForPreview(booted, port, signal)
  // Recorded only once the device is actually in hand: a declined or failed request
  // is not something the next `device_list` should recommend.
  recents.remember(booted.id)
  return readyResult(booted, port, false)
}
