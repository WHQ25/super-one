/**
 * Devices the user has agreed the agent may drive, standing.
 *
 * `device_request_control` offers exactly two answers, and they differ in LIFETIME
 * rather than in reach:
 *
 * - **this chat** — the default accept. Nothing is written here at all: the binding it
 *   produces already dies with the session, so "session-scoped" needs no storage and
 *   cannot go stale.
 * - **always** — from now on, in every session and every project. That is this module.
 *
 * There is deliberately no third, narrower scope. A per-project grant would still
 * re-ask the next time the same user opened the same simulator from a different
 * folder, which is precisely the friction the standing answer exists to remove.
 *
 * Per DEVICE, though. "Let the agent drive my simulators" and "let it drive the phone
 * on my desk" are different decisions, and the second one is about someone's real
 * device.
 *
 * Read fresh from settings on every check rather than cached, so revoking the toggle
 * in the device tab takes effect on the very next tool call — the same reasoning as
 * `syncWebMcpTrustFromSettings`. It is one small file read per grant request, which
 * happens once per conversation at most.
 */

import type { DeviceControlGrant } from '@superone/shared/agent-types'
import { readAppSettings, saveAppSettings } from '../app-settings-service'

/** What one device looks like to this module. Avoids dragging `DeviceDescriptor` in. */
export interface DeviceGrantSubject {
  id: string
  name: string
  platformVersion?: string
}

/** The slice of storage the control flow needs, so tests need no settings file. */
export interface DeviceGrantsPort {
  /** Whether the user already said yes to this device, standing. */
  isGranted(deviceId: string): boolean
  /** Record a standing yes. Idempotent. */
  grant(device: DeviceGrantSubject): void
}

export const NO_DEVICE_GRANTS: DeviceGrantsPort = {
  isGranted: () => false,
  grant: () => {},
}

/**
 * Failures are swallowed in both directions, for different reasons. An unreadable
 * settings file means "no standing grant", which costs one prompt — the safe
 * direction. A failed write is silent because the grant it was recording has already
 * been given for this conversation; only the standing part is lost.
 */
export const DEVICE_GRANTS: DeviceGrantsPort = {
  isGranted(deviceId: string): boolean {
    try {
      return readAppSettings().deviceControlGrants.some((grant) => grant.deviceId === deviceId)
    } catch {
      return false
    }
  },
  grant(device: DeviceGrantSubject): void {
    try {
      const current = readAppSettings().deviceControlGrants
      if (current.some((grant) => grant.deviceId === device.id)) return
      const entry: DeviceControlGrant = {
        deviceId: device.id,
        deviceName: device.name,
        ...(device.platformVersion ? { platformVersion: device.platformVersion } : {}),
      }
      saveAppSettings({ deviceControlGrants: [...current, entry] })
    } catch {
      // The session already holds the device; only the standing part is lost.
    }
  },
}
