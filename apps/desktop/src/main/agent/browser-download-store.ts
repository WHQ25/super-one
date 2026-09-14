import { adoptWriteClaim, beginActiveWrite, releaseWriteClaim, sealActiveWrite } from '../environment/active-writes'
import { ensureZoneDir } from '../environment/zone-owner'
import { realOrSelf, withinSessionZone } from '../environment/sync-zone-paths'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, statSync } from 'fs'
import { basename, extname, isAbsolute, join } from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { readAppSettings } from '../app-settings-service'
import { isUnderSyncZone, producerDir, zoneRelativePath } from '../media-output-paths'
import { currentCallOwner, currentHostActionConnection, registerArtifact } from '../mcp/artifact-registry'
import log from '../logger'

import { BROWSER_DOWNLOAD_FALLBACK_DIR as FALLBACK_DIR } from '../media-output-paths'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'text/plain': 'txt',
  'text/html': 'html',
  'audio/mpeg': 'mp3',
  'application/octet-stream': 'bin',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

const RESERVED_FILENAME_CHARS = /[/\\:*?"<>|]/g

function extForMime(mimeType: string): string {
  const mime = mimeType.split(';')[0].trim().toLowerCase()
  if (MIME_EXT[mime]) return MIME_EXT[mime]
  const sub = mime.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/g, '')
  return sub || 'bin'
}

// basename() strips any traversal a hostile Content-Disposition or URL path
// could smuggle in; the rest are characters no filesystem should have to take.
function sanitize(name: string): string {
  const printable = Array.from(basename(name))
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
  const base = printable.replace(RESERVED_FILENAME_CHARS, '_').trim()
  if (!base || base === '.' || base === '..') return ''
  return base.slice(0, 120)
}

export function filenameFor(rawName: string, url: string, mimeType: string): string {
  const ext = extForMime(mimeType)
  let name = sanitize(rawName)
  if (!name && !url.startsWith('data:')) {
    try {
      name = sanitize(decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''))
    } catch {
      name = ''
    }
  }
  if (!name) return `download.${ext}`
  return extname(name) ? name : `${name}.${ext}`
}

/** The OS Downloads folder, or a temp dir on the rare platform without one. */
export function systemDownloadDir(): string {
  try {
    return app.getPath('downloads')
  } catch {
    return FALLBACK_DIR
  }
}

/**
 * Where a download should land, in precedence order: the caller's explicit
 * directory, the user's configured default, then the OS Downloads folder.
 * Only absolute paths are honoured — a relative one has no meaningful base in
 * the main process, so it is rejected rather than resolved against cwd.
 *
 * A **remote session** changes both ends of that. Its agent runs on the node
 * and can only read what is in the session sync zone, so with no directory the
 * download goes there rather than into this machine's Downloads folder, and a
 * directory outside the zone is refused instead of silently writing somewhere
 * the agent will never reach (`docs/design/session-sync-zone.md` §9). A node
 * path the agent asked for has already been rewritten to its desktop mirror by
 * the Host Action input mapping (§3.1), so it arrives here inside the zone.
 */
/**
 * Where a download comes from when the caller knows: a page-triggered capture
 * runs in an event handler, outside any tool call, so it names the driving
 * session's connection itself instead of relying on the call scope.
 */
export interface DownloadOrigin {
  connectionId: string | null
}

export function resolveDownloadDir(explicitDir?: string | null, sessionId?: string | null, origin?: DownloadOrigin): string {
  const explicit = explicitDir?.trim()
  const remote = sessionId ? (origin ? origin.connectionId !== null : currentHostActionConnection() !== null) : false
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error(`Download directory must be an absolute path: ${explicit}`)
    if (remote && !withinSessionZone(sessionId!, explicit)) {
      throw new Error(
        `This session runs on a remote node, so ${explicit} is a directory its agent cannot read. `
        + 'Omit `dir` to download into the session directory ($SUPERONE_SESSION_DIR), or name a path inside it.',
      )
    }
    return explicit
  }
  if (remote) {
    // The default goes through the same containment check as an explicit
    // directory. It is derived from the session id rather than given, but a
    // link anywhere on the way still decides where the bytes land.
    const dir = producerDir(sessionId, 'download')
    if (!withinSessionZone(sessionId!, dir)) {
      throw new Error(`The session directory for this remote session is not usable: ${dir}`)
    }
    return dir
  }
  return readAppSettings().browserDownloadDir || systemDownloadDir()
}

/**
 * Create the target directory. A directory the agent named explicitly is its
 * responsibility, so a failure surfaces as an error; a failing *configured*
 * default must not break downloading, so it degrades to the OS folder.
 */
function ensureDir(explicitDir?: string | null, sessionId?: string | null, origin?: DownloadOrigin): string {
  const root = resolveDownloadDir(explicitDir, sessionId, origin)
  try {
    // A capture outside any tool call names its connection; a tool call's
    // scope knows it. Either way the directory is marked for the sweep.
    ensureZoneDir(root, origin ? origin.connectionId : currentCallOwner())
    return root
  } catch (err) {
    // A directory the agent named is its own choice, and a remote session's
    // zone is the only place its agent can read. Neither may quietly become
    // this machine's Downloads folder: the download would report a path that
    // works here and nowhere the caller can look.
    if (explicitDir?.trim() || isUnderSyncZone(root)) throw err
    log.warn(`[browser-download] cannot use ${root}, falling back: ${err instanceof Error ? err.message : String(err)}`)
  }
  const fallback = systemDownloadDir()
  try {
    mkdirSync(fallback, { recursive: true })
    return fallback
  } catch {
    mkdirSync(FALLBACK_DIR, { recursive: true })
    return FALLBACK_DIR
  }
}

function uniqueCandidate(dir: string, filename: string, attempt: number): string {
  if (attempt === 0) return join(dir, filename)
  const ext = extname(filename)
  const stem = ext ? filename.slice(0, -ext.length) : filename
  return join(dir, `${stem} (${attempt})${ext}`)
}

/**
 * Reserve an absolute path for a download and return it. Mirrors
 * persistScreenshot's contract: the model gets a path, not bytes. Downloads
 * share one user-visible directory, so the reservation is an exclusive create
 * (`wx`) — that both skips names already on disk and keeps two concurrent
 * downloads of the same file from racing onto the same path.
 */
export function reserveDownloadPath(filename: string, dir?: string | null, sessionId?: string | null, origin?: DownloadOrigin): string {
  const root = ensureDir(dir, sessionId, origin)
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = uniqueCandidate(root, filename, attempt)
    try {
      closeSync(openSync(candidate, 'wx'))
      registerDownload(sessionId, candidate, false)
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  // 100 same-named files in one folder: stop guessing and make the name unique.
  const ext = extname(filename)
  const stem = ext ? filename.slice(0, -ext.length) : filename
  return join(root, `${stem} (${randomUUID().slice(0, 8)})${ext}`)
}

/**
 * This session's zone directory, canonicalised — or null when it cannot serve
 * as a boundary because it is itself a link. Resolving such a link would move
 * the boundary to wherever it points, so everything under it would then read
 * as "inside the zone", including the directory it was aimed at. The node
 * applies the same rule to its own session directories.
 */

/**
 * A download is registered when its path is reserved and again when the bytes
 * are in: the reservation is what a *background* download's reply names, and
 * the seal is what makes the file worth pushing. Only zone paths are pushed,
 * so a local session's Downloads folder is unaffected.
 */
export function registerDownload(sessionId: string | null | undefined, path: string, final: boolean): void {
  if (!sessionId || !isUnderSyncZone(path)) return
  // The same two moments the registry cares about are the two the mirror does:
  // the reservation opens a window in which the file exists but no transfer job
  // does, and the seal closes it only once the file has been handed on. A
  // second seal of an already-sealed path (a listing re-registering an adopted
  // download) is a no-op.
  if (final) sealActiveWrite(sessionId, path)
  else beginActiveWrite(sessionId, path)
  registerArtifact(sessionId, { path, producer: 'download', final })
}

/**
 * Hand a finished zone download to the transfer service. The artifact
 * registry cannot: a download finishes after (or outside) the tool call it
 * belongs to, so there is no scope left to register into. The job's own
 * completion wake tells the agent the node path works
 * (`docs/design/session-sync-zone.md` §4.1).
 */
export function queueDownloadUpload(connectionId: string, sessionId: string, path: string): void {
  const zone = zoneRelativePath(path)
  if (!zone || zone.sessionId !== sessionId) return
  // Take responsibility before the first attempt, so a Host Action returning
  // in the meantime cannot release the file out from under the queue.
  const owned = adoptWriteClaim(sessionId, path, 'queue')
  // One id for the whole handoff, retries included: a new id would make the
  // node meet a second transfer instead of resuming the partial one it holds.
  void enqueueWithRetry(connectionId, sessionId, path, zone.relativePath, owned, randomUUID())
}

/** Attempts, then the delay before each retry. Short: the file is unprotected work in progress. */
const DEFER_RETRY_DELAYS_MS = [100, 500, 2000, 5000]

/**
 * File the transfer job, retrying a transient failure.
 *
 * The claim is released only when a row demonstrably exists. A `defer` that
 * threw, or a transfer service that is not there at all, is NOT a handoff —
 * releasing on either turns the only complete copy of the file into something
 * the next directory mirror prunes. Pinning the path is the lesser failure,
 * and it is logged as an error so it is not silent.
 */
async function enqueueWithRetry(
  connectionId: string,
  sessionId: string,
  path: string,
  relativePath: string,
  owned: boolean,
  transferId: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { getEnvironmentHost } = await import('../environment/environment-host')
      const transfers = getEnvironmentHost().artifactTransfers
      if (!transfers) throw new Error('no artifact transfer service on this host')
      await transfers.defer({ connectionId, sessionId, localPath: path, relativePath, transferId })
      if (owned) releaseWriteClaim(sessionId, path, 'queue')
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const delay = DEFER_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        // Out of short retries, but not out of options: the file goes on the
        // pending-handoff table, which keeps it protected and is retried when
        // the connection's transfer worker next starts. The claim is NOT
        // released — the entry records who holds it so recovery can.
        const { recordFailedHandoff } = await import('../environment/pending-handoffs')
        recordFailedHandoff({
          connectionId,
          sessionId,
          localPath: path,
          relativePath,
          transferId,
          holder: owned ? 'queue' : 'writer',
          bytes: sizeOf(path),
          lastError: message,
          attempts: attempt,
        })
        return
      }
      log.warn('[browser-download] queueing the node transfer failed (%s), retrying in %dms', message, delay)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/** Size for the Storage figure; zero when the file cannot be read. */
function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** Page downloads already adopted, so a second listing reuses the same copy. */
const adopted = new Map<string, string>()

/**
 * Bring a download the *page* started into the session zone.
 *
 * `will-download` has to name a save path synchronously, and which tab owns
 * which session is renderer state resolved over an async call — so a
 * page-triggered download cannot be filed by session at capture time the way
 * `browser_download` is. It is adopted here instead, when the agent asks for
 * the list and the session is finally known: the file is copied into the
 * zone, registered, and the zone path is what the agent is told
 * (`docs/design/session-sync-zone.md` §6).
 *
 * Returns the path to report — the original when there is nothing to adopt.
 */
export function adoptCapturedDownload(sessionId: string | null | undefined, path: string): string {
  if (!sessionId || !path) return path
  if (currentHostActionConnection() === null) return path
  // Captured straight into the zone (the tab's driver was known): nothing to
  // copy, but the listing still needs a ref or its reply is not rewritten.
  if (isUnderSyncZone(path)) {
    if (zoneRelativePath(path)?.sessionId === sessionId) registerDownload(sessionId, path, true)
    return path
  }
  // Listing is not a one-shot: the agent may ask twice, and adopting twice
  // would leave two copies and two node uploads of one download.
  const key = `${sessionId}\u0000${realOrSelf(path)}`
  const already = adopted.get(key)
  if (already && existsSync(already)) {
    // The copy is reused; the ref is not. Each reply is rewritten from the
    // refs of its own call, so a listing that registers nothing hands the
    // agent the desktop path again.
    registerDownload(sessionId, already, true)
    return already
  }
  try {
    // An exclusive reservation, not a plain join: `download/report.csv` may
    // already be a file some earlier turn named, and overwriting it would
    // silently change what that path means in the transcript.
    const target = reserveDownloadPath(basename(path), null, sessionId)
    copyFileSync(path, target)
    registerDownload(sessionId, target, true)
    adopted.set(key, target)
    return target
  } catch (err) {
    log.warn(`[browser-download] could not adopt ${path} into the session zone: ${err instanceof Error ? err.message : String(err)}`)
    return path
  }
}
