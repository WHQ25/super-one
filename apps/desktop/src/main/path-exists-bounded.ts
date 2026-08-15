import { stat } from 'node:fs/promises'
import { DEADLINE_EXCEEDED, withDeadline } from './promise-deadline'

/** Default budget for a presence check that must not stall the main thread. */
export const PATH_EXISTS_LIST_TIMEOUT_MS = 400
/** Slightly looser budget when the user (or boot) is about to open a folder. */
export const PATH_EXISTS_OPEN_TIMEOUT_MS = 2_000

/**
 * `fs.existsSync` / unbounded `stat` on a disconnected Windows UNC share or
 * mapped drive can block the Electron main thread for tens of seconds. A hung
 * check during GET_RECENT_FOLDERS leaves the renderer on its empty loading
 * view — the same "white screen" users report after the React #185 fixes.
 *
 * Timed-out paths are treated as missing so boot can skip them.
 */
export async function pathExistsBounded(
  target: string,
  timeoutMs: number = PATH_EXISTS_LIST_TIMEOUT_MS,
): Promise<boolean> {
  if (!target) return false
  const result = await withDeadline(
    stat(target).then(
      () => true,
      () => false,
    ),
    timeoutMs,
  )
  return result === DEADLINE_EXCEEDED ? false : result
}
