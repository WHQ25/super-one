/**
 * Computer Use's leg of the shared agent viewfinder.
 *
 * The floating preview is one slot, shared with the device panel's and the browser's
 * — see `stores/agent-viewfinder` in the renderer, which owns the arbitration. This
 * side is different from the other two in one way that shapes everything here: the
 * PiP is a native macOS window owned by the helper, so the renderer can neither
 * position it nor stack it. It can only be told to stand down.
 *
 * Hence two one-way signals rather than shared state:
 *
 * - CLAIM, main to renderer. Emitted the moment Computer Use is about to show its
 *   viewfinder, which is exactly the moment it becomes the most recently touched
 *   target. The renderer stamps it and its own previews step aside.
 * - YIELD, renderer to main. Set while a pinned device or browser preview outranks
 *   Computer Use, which is the only way it loses — an ordinary agent action always
 *   arrives newer than whatever was on screen before it.
 *
 * The flag is consulted before every show rather than only when it changes, so a
 * yield that lands mid-turn takes effect on the next action without anything having
 * to remember to re-apply it.
 */

let yielded = false
let claimSink: ((claim: { sessionId: string; active: boolean }) => void) | null = null

/**
 * How a claim reaches the renderer.
 *
 * Injected rather than imported: this module is pulled in by `create-service`, which
 * runs in unit tests with no Electron at all, and a `BrowserWindow` import there
 * would take the whole computer-use service down with it.
 */
export function setComputerUseViewfinderClaimSink(
  sink: ((claim: { sessionId: string; active: boolean }) => void) | null,
): void {
  claimSink = sink
}

/** Computer Use is about to show its viewfinder — it is now the newest target. */
export function claimComputerUseViewfinder(sessionId: string): void {
  claimSink?.({ sessionId, active: true })
}

/**
 * The turn ended, or the visuals were torn down. Nothing to show here any more.
 *
 * Without it the other two previews go on standing aside for a target that stopped
 * moving, which is the same bug as showing the wrong one — just quieter.
 */
export function releaseComputerUseViewfinder(sessionId = ''): void {
  claimSink?.({ sessionId, active: false })
}

/**
 * Stand down, or resume.
 *
 * Returns whether the value changed, so the caller can hide the native window once
 * rather than on every report the renderer sends.
 */
export function setComputerUseViewfinderYielded(next: boolean): boolean {
  if (yielded === next) return false
  yielded = next
  return true
}

export function isComputerUseViewfinderYielded(): boolean {
  return yielded
}
