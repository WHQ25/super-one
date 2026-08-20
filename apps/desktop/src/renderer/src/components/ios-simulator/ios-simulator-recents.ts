import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'

// Recents are a machine-level convenience, not session state, so they live in
// localStorage rather than the session DB. Only udids are stored: the name and
// runtime are re-read from simctl so a renamed simulator never shows a stale label.
const STORAGE_KEY = 'superone.iosSimulator.recentUdids'

export const IOS_SIMULATOR_RECENT_LIMIT = 5

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): WritableStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function readRecentUdids(storage: ReadableStorage | null = defaultStorage()): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, IOS_SIMULATOR_RECENT_LIMIT)
  } catch {
    return []
  }
}

export function rememberRecentUdid(
  udid: string,
  storage: WritableStorage | null = defaultStorage(),
): string[] {
  const next = [udid, ...readRecentUdids(storage).filter((entry) => entry !== udid)]
    .slice(0, IOS_SIMULATOR_RECENT_LIMIT)
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // A full or disabled storage costs the shortcut, not the launch.
  }
  return next
}

/** Drops simulators that were deleted or became unavailable since they were used. */
export function resolveRecentDevices(
  udids: string[],
  devices: IosSimulatorDevice[],
): IosSimulatorDevice[] {
  return udids.flatMap((udid) => {
    const device = devices.find((entry) => entry.udid === udid)
    return device?.available ? [device] : []
  })
}
