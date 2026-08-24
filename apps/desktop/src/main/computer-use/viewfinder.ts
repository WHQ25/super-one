/**
 * Main-process bridge for Computer Use's renderer-owned viewfinder.
 *
 * The signed helper still captures native windows with ScreenCaptureKit, but it no
 * longer creates an NSPanel. Target metadata and compressed frames cross the existing
 * helper event channel and are forwarded to the renderer that owns the session UI.
 */

import type {
  ComputerUseViewfinderClaim,
  ComputerUseViewfinderFrame,
} from '@superone/shared/agent-types'
import type { HelperEvent } from './platform/helper-protocol'

let claimSink: ((claim: ComputerUseViewfinderClaim) => void) | null = null
let frameSink: ((frame: ComputerUseViewfinderFrame) => void) | null = null
const activeClaims = new Map<string, ComputerUseViewfinderClaim>()

/**
 * How a claim reaches the renderer.
 *
 * Injected rather than imported: this module is pulled in by `create-service`, which
 * runs in unit tests with no Electron at all, and a `BrowserWindow` import there
 * would take the whole computer-use service down with it.
 */
export function setComputerUseViewfinderClaimSink(
  sink: ((claim: ComputerUseViewfinderClaim) => void) | null,
): void {
  claimSink = sink
}

export function setComputerUseViewfinderFrameSink(
  sink: ((frame: ComputerUseViewfinderFrame) => void) | null,
): void {
  frameSink = sink
}

/** Computer Use is about to show this target — it is now the newest target. */
export function claimComputerUseViewfinder(
  claim: Omit<ComputerUseViewfinderClaim, 'active'>,
): void {
  const activeClaim = { ...claim, active: true }
  activeClaims.set(claim.sessionId, activeClaim)
  claimSink?.(activeClaim)
}

/**
 * The turn ended, or the visuals were torn down. Nothing to show here any more.
 *
 * Without it the other two previews go on standing aside for a target that stopped
 * moving, which is the same bug as showing the wrong one — just quieter.
 */
export function releaseComputerUseViewfinder(sessionId = ''): void {
  if (sessionId) activeClaims.delete(sessionId)
  else activeClaims.clear()
  claimSink?.({ sessionId, active: false })
}

/** Resolve a renderer click against helper-originated state, never renderer metadata. */
export function getComputerUseViewfinderTarget(
  sessionId: string,
): ComputerUseViewfinderClaim | null {
  return activeClaims.get(sessionId) ?? null
}

/** Validate and forward one helper frame without exposing arbitrary helper events. */
export function forwardComputerUseViewfinderFrame(event: HelperEvent): boolean {
  const frame = event as Record<string, unknown>
  if (event.event === 'computer_use_viewfinder_stopped') {
    if (typeof frame.sessionId !== 'string') return false
    releaseComputerUseViewfinder(frame.sessionId)
    return true
  }
  if (event.event !== 'computer_use_viewfinder_frame') return false
  if (typeof frame.sessionId !== 'string'
    || typeof frame.windowId !== 'number'
    || typeof frame.width !== 'number'
    || typeof frame.height !== 'number'
    || typeof frame.data !== 'string') return false
  frameSink?.({
    sessionId: frame.sessionId,
    windowId: frame.windowId,
    width: frame.width,
    height: frame.height,
    data: frame.data,
  })
  return true
}
