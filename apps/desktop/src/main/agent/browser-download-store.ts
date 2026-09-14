import { publishArtifact, reserveZoneFile, ZoneDeliveryRefused } from '../environment/zone-delivery'
import { ensureZoneDir } from '../environment/zone-owner'
import { realOrSelf, withinSessionZone } from '../environment/sync-zone-paths'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, unlinkSync } from 'fs'
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
    if (claimDownloadName(candidate, sessionId, origin)) {
      registerDownload(sessionId, candidate, false, origin)
      return candidate
    }
  }
  // 100 same-named files in one folder: stop guessing and make the name unique.
  // Reserved exactly like the others — this used to hand back a path with no
  // file created and no claim taken, the one download the mirror could prune.
  const ext = extname(filename)
  const stem = ext ? filename.slice(0, -ext.length) : filename
  for (;;) {
    const unique = join(root, `${stem} (${randomUUID().slice(0, 8)})${ext}`)
    if (claimDownloadName(unique, sessionId, origin)) {
      registerDownload(sessionId, unique, false, origin)
      return unique
    }
  }
}

/**
 * Take one candidate name, or say it is not free. A name is free only when
 * BOTH the filesystem and the delivery record say so: the `wx` create picks
 * it atomically on disk, and the record must accept it as never written in
 * this session (R2). A vacancy on disk is not a free name — a delivered file
 * the node has since deleted leaves exactly that, and a new download slipping
 * into its row would be reported as already delivered. On `path-taken` the
 * empty stub this call created is removed and the next name is tried. Any
 * other refusal — the session dropped, no destination to promise the file to
 * — is the download's failure: the stub is removed and the refusal raised.
 */
function claimDownloadName(candidate: string, sessionId: string | null | undefined, origin?: DownloadOrigin): boolean {
  try {
    closeSync(openSync(candidate, 'wx'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    return false
  }
  if (!sessionId || !isUnderSyncZone(candidate)) return true
  try {
    reserveZoneFile({
      sessionId,
      path: candidate,
      origin: origin ? 'page-download' : 'download',
      ...(origin ? { connectionId: origin.connectionId } : {}),
    })
    return true
  } catch (err) {
    unlinkSync(candidate)
    if (err instanceof ZoneDeliveryRefused && err.reason === 'path-taken') return false
    throw err
  }
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
export function registerDownload(sessionId: string | null | undefined, path: string, final: boolean, origin?: DownloadOrigin): void {
  if (!sessionId || !isUnderSyncZone(path)) return
  // The reservation itself was made by `claimDownloadName`, in the same
  // synchronous sequence as the `wx` create; this registers the ref (with the
  // reservation's id) and, on `final`, seals it. A second seal of an already
  // sealed path (a listing re-registering an adopted download) reuses the row.
  publishArtifact(sessionId, { path, producer: 'download', final, ...(origin ? { connectionId: origin.connectionId } : {}) })
}

/**
 * A finished zone download that no tool call is left to push — it was
 * backgrounded, or it was the page's own — is a sealed row the worker will
 * take; this only makes the worker look now rather than at its next tick. The
 * delivery's own completion wake tells the agent the node path works
 * (`docs/design/session-sync-zone.md` §4.1).
 */
export function wakeDownloadDelivery(connectionId: string): void {
  void import('../environment/environment-host').then(({ getEnvironmentHost }) => getEnvironmentHost().artifactTransfers?.wake(connectionId))
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
