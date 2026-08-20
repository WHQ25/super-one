import {
  DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY,
  IOS_SIMULATOR_PREVIEW_FRAME_RATES,
  IOS_SIMULATOR_PREVIEW_SCALES,
  type IosSimulatorPreviewQuality,
} from '@superone/shared/ios-simulator'

// Preview quality is a machine-level preference, like the recents list: it tracks
// how much this Mac can spare, not anything about the session or the device.
const STORAGE_KEY = 'superone.iosSimulator.previewQuality'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): WritableStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

/** Snaps to an offered value so a hand-edited or outdated entry cannot pin an odd size. */
function nearestOffered(value: unknown, offered: readonly number[]): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return offered.find((option) => Math.abs(option - value) < 0.001) ?? null
}

export function readPreviewQuality(
  storage: ReadableStorage | null = defaultStorage(),
): IosSimulatorPreviewQuality {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY
    const record = parsed as Record<string, unknown>
    return {
      scale: nearestOffered(record.scale, IOS_SIMULATOR_PREVIEW_SCALES)
        ?? DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY.scale,
      maxFrameRate: nearestOffered(record.maxFrameRate, IOS_SIMULATOR_PREVIEW_FRAME_RATES)
        ?? DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY.maxFrameRate,
    }
  } catch {
    return DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY
  }
}

export function writePreviewQuality(
  quality: IosSimulatorPreviewQuality,
  storage: WritableStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(quality))
  } catch {
    // A full or disabled storage costs the preference, not the preview.
  }
}

/**
 * What the device will actually be encoded at. Rounded to even pixels because that
 * is what the helper's encoder does, so the menu never advertises a size the stream
 * cannot produce.
 */
export function scaledPreviewSize(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  if (scale >= 1) return { width, height }
  return {
    width: Math.max(16, Math.round(width * scale) & ~1),
    height: Math.max(16, Math.round(height * scale) & ~1),
  }
}
