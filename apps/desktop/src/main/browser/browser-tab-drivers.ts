/**
 * Which session last drove each browser view, and from which node.
 *
 * Tab ownership is renderer state behind an async call, and Electron's
 * `will-download` has to name a save path synchronously — so a download the
 * page starts cannot ask who owns the tab. It can ask who last *drove* it:
 * every browser tool call resolves its view through `resolveBrowserWebContentsId`,
 * and that is the moment to remember the session (and, for a Host Action,
 * the node) behind the view. A page a remote agent clicked "export" on is a
 * page that agent drove a moment ago (`docs/design/session-sync-zone.md` §6).
 */
export interface TabDriver {
  sessionId: string
  /** The node the driving session runs on; null for a local session. */
  connectionId: string | null
}

const drivers = new Map<number, TabDriver>()

export function rememberTabDriver(webContentsId: number, sessionId: string, connectionId: string | null): void {
  drivers.set(webContentsId, { sessionId, connectionId })
}

export function tabDriver(webContentsId: number | undefined): TabDriver | null {
  return webContentsId == null ? null : drivers.get(webContentsId) ?? null
}

export function forgetTabDriver(webContentsId: number): void {
  drivers.delete(webContentsId)
}
