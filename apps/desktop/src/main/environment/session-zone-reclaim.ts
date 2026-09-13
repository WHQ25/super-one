/**
 * Session deletion reclaims its sync zone (`docs/design/session-sync-zone.md` §7).
 *
 * Two sides, both routed here so neither is forgotten:
 *  - the desktop copy under `<userData>/sync/<sessionId>` is removed;
 *  - any in-flight or queued transfer job for the session is cancelled.
 * The node's own copy is dropped by the node when the session is removed there
 * (`session.remove` → `artifact.delete`), or the whole session directory when
 * the desktop calls `artifactDelete` in `EnvironmentHost.removeSession`.
 *
 * `adhoc` holds captures taken with no session and is never auto-deleted.
 */
import { rm } from 'node:fs/promises'
import { ADHOC_SESSION_ID, sessionZoneDir } from '../media-output-paths'

export async function removeSessionZone(sessionId: string): Promise<void> {
  if (!sessionId || sessionId === ADHOC_SESSION_ID) return
  const { getEnvironmentHost } = await import('./environment-host')
  getEnvironmentHost().artifactTransfers?.dropSession(sessionId)
  await rm(sessionZoneDir(sessionId), { recursive: true, force: true })
}
