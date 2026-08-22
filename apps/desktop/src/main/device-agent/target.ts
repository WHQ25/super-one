/**
 * Which of a session's devices a `device_*` call meant.
 *
 * A chat session can drive several at once — the case this exists for is one
 * conversation testing a client build on one phone against a merchant build on
 * another — so "the session's device" stopped being a question with an answer.
 *
 * The rule is deliberately strict rather than helpful: with two devices in hand and
 * no `device` named, this REFUSES instead of picking. A wrong guess here does not
 * fail loudly, it taps the merchant app while the agent believes it is in the client
 * app, and every observation afterwards reads as a bug in the app under test. One
 * device is the only case where a default is not a guess.
 */

import { DeviceAgentError } from './types'

/** A device this session holds, as much of it as is known without a fresh listing. */
export interface HeldDevice {
  id: string
  /** Its user-facing name, when the last listing saw it. Only used in messages. */
  name?: string
}

function describe(device: HeldDevice): string {
  return device.name ? `${device.id} (${device.name})` : device.id
}

/**
 * Match the handle the agent quoted against what it actually holds.
 *
 * Matched loosely for the same reason `resolveDevice` is: the agent writes ids from
 * `device_list` but also names from what the user said in chat. Unlike that one, this
 * only ever searches devices the session HAS — so a loose match cannot reach a device
 * nobody granted.
 */
function match(held: readonly HeldDevice[], ref: string): HeldDevice | null {
  const needle = ref.trim().toLowerCase()
  if (!needle) return null
  return held.find((device) => device.id.toLowerCase() === needle)
    // A bare udid or adb serial, copied out of a log or read back from `simctl`.
    ?? held.find((device) => {
      const separator = device.id.indexOf(':')
      return separator > 0 && device.id.slice(separator + 1).toLowerCase() === needle
    })
    ?? held.find((device) => device.name?.toLowerCase() === needle)
    ?? held.find((device) => Boolean(device.name && device.name.toLowerCase().includes(needle)))
    ?? null
}

export function resolveHeldDevice(
  held: readonly HeldDevice[],
  ref: string | undefined,
): string {
  if (held.length === 0) {
    throw new DeviceAgentError(
      'NO_DEVICE',
      'This session controls no device. Call device_list, then device_request_control with an id from it.',
    )
  }

  if (ref?.trim()) {
    const chosen = match(held, ref)
    if (chosen) return chosen.id
    throw new DeviceAgentError(
      'NO_DEVICE',
      `This session does not control "${ref}". It controls ${held.map(describe).join(', ')}. `
        + 'Name one of those, or call device_request_control to be granted another.',
    )
  }

  if (held.length === 1) return held[0]!.id

  throw new DeviceAgentError(
    'NO_DEVICE',
    `This session controls ${held.length} devices, so this call must name one: ${held.map(describe).join(', ')}. `
      + 'Pass `device` with the id of the one you mean — driving the wrong app looks like a bug in the right one.',
  )
}
