import type { DeviceDescriptor } from '@superone/shared/device'

// Recents are a machine-level convenience, not session state, so they live in
// localStorage rather than the session DB. Only ids are stored, and they carry their
// platform (`ios:<udid>`, `android:avd:<name>`), so one list serves both and a
// renamed device never shows a stale label — everything else is re-read from the
// catalog.
const STORAGE_KEY = 'superone.device.recentIds'
const LEGACY_STORAGE_KEY = 'superone.iosSimulator.recentUdids'

export const DEVICE_RECENT_LIMIT = 5

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): WritableStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function readRecentDeviceIds(storage: ReadableStorage | null = defaultStorage()): string[] {
  try {
    const current = storage?.getItem(STORAGE_KEY)
    const legacy = current == null ? storage?.getItem(LEGACY_STORAGE_KEY) : null
    const parsed: unknown = JSON.parse(current ?? legacy ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => legacy != null && !entry.includes(':') ? `ios:${entry}` : entry)
      .slice(0, DEVICE_RECENT_LIMIT)
  } catch {
    return []
  }
}

export function rememberRecentDeviceId(
  deviceId: string,
  storage: WritableStorage | null = defaultStorage(),
): string[] {
  const next = [deviceId, ...readRecentDeviceIds(storage).filter((entry) => entry !== deviceId)]
    .slice(0, DEVICE_RECENT_LIMIT)
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // A full or disabled storage costs the shortcut, not the launch.
  }
  return next
}

/** Drops devices that were deleted or became unavailable since they were used. */
export function resolveRecentDevices(
  deviceIds: string[],
  devices: DeviceDescriptor[],
): DeviceDescriptor[] {
  return deviceIds.flatMap((deviceId) => {
    const device = devices.find((entry) => entry.id === deviceId)
    return device?.available ? [device] : []
  })
}
