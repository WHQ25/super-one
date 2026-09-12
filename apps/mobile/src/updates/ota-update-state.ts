/**
 * What the OTA (JS bundle) updater shows, derived from expo-updates' native
 * state machine.
 *
 * The native side owns the whole lifecycle -- it checks on launch, downloads,
 * and holds the downloaded bundle until the next launch. This module only
 * decides how that reads on screen, so the rules are testable without React
 * Native; the subscription and the reload live in `update-ports.ts`.
 */

/** The subset of `UpdatesNativeStateMachineContext` the view depends on. */
export type OtaNativeState = {
  isUpdateAvailable: boolean
  isDownloading: boolean
  isUpdatePending: boolean
  isRestarting: boolean
  /** 0..1 while downloading; the native side reports 0 before bytes move. */
  downloadProgress: number
  hasDownloadError: boolean
}

export const OTA_IDLE: OtaNativeState = {
  isUpdateAvailable: false,
  isDownloading: false,
  isUpdatePending: false,
  isRestarting: false,
  downloadProgress: 0,
  hasDownloadError: false,
}

export type OtaView =
  | { phase: 'hidden' }
  | { phase: 'downloading'; fraction: number | null }
  | { phase: 'restarting' }

/**
 * Nothing is shown until an update is known to exist, so a launch that finds
 * nothing never flashes a gate. A download that failed is dropped silently:
 * the native side retries on the next launch and there is nothing the user
 * could do about it here.
 */
export function deriveOtaView(state: OtaNativeState, reloadFailed = false): OtaView {
  if (reloadFailed) return { phase: 'hidden' }
  if (state.isUpdatePending || state.isRestarting) return { phase: 'restarting' }
  if (state.hasDownloadError) return { phase: 'hidden' }
  if (state.isDownloading) return { phase: 'downloading', fraction: clampFraction(state.downloadProgress) }
  if (state.isUpdateAvailable) return { phase: 'downloading', fraction: 0 }
  return { phase: 'hidden' }
}

function clampFraction(value: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}
