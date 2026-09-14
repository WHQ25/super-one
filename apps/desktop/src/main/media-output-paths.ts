import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { app } from 'electron'

/**
 * Where session artifacts live.
 *
 * The **sync zone** is one directory per session under `userData`, one
 * subdirectory per producer (`docs/design/session-sync-zone.md` §2). A remote
 * node mirrors the same relative layout under its own home, so a path on one
 * side maps to the other by prefix replacement alone. Local sessions use the
 * exact same layout — there is nothing to sync, but session deletion has a
 * directory to remove and every reader shares one allowlist.
 *
 * The temp roots below are the layout that preceded the zone. Device captures,
 * recordings and download fallbacks still write there until they migrate; the
 * media readers keep them readable so saved transcripts do not 403.
 */
export const CAPTURE_ROOT = join(tmpdir(), 'super-one-captures')
export const RECORDING_ROOT = join(tmpdir(), 'super-one-recordings')
export const BROWSER_DOWNLOAD_FALLBACK_DIR = join(tmpdir(), 'super-one-browser-downloads')

export type CaptureProducer = 'browser' | 'computer-use' | 'ios-simulator' | 'android' | 'ios-mirror'
export type ArtifactProducer = CaptureProducer | 'recording' | 'media-gen' | 'download' | 'agent'

/** Zone id for artifacts produced with no session (manual UI captures). Never auto-deleted. */
export const ADHOC_SESSION_ID = 'adhoc'

/** Legacy temp directory of one capture producer — device backends until they migrate. */
export function captureDir(producer: CaptureProducer): string {
  return join(CAPTURE_ROOT, producer)
}

/** Keep the legacy producers and both media transports on the same directory contract. */
/**
 * Temp roots that predate the sync zone. Captures and recordings write into
 * the zone now, but a transcript from before this change still names a file
 * here, so these stay readable (`docs/design/session-sync-zone.md` §6).
 */
export function builtInCaptureRoots(): string[] {
  return [CAPTURE_ROOT, RECORDING_ROOT, BROWSER_DOWNLOAD_FALLBACK_DIR]
}

/** `<userData>/sync` — the desktop side of the session sync zone. */
export function syncZoneRoot(): string {
  return join(app.getPath('userData'), 'sync')
}

/**
 * A zone id is exactly one path component. Session ids are UUIDs, but the
 * directory name is what scopes every reader and the node's RPCs, so anything
 * that could climb out is refused rather than sanitised.
 */
export function assertZoneSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    throw new Error(`invalid sync zone session id: ${JSON.stringify(sessionId)}`)
  }
  return sessionId
}

function zoneSessionId(sessionId: string | null | undefined): string {
  return sessionId && sessionId.length > 0 ? assertZoneSessionId(sessionId) : ADHOC_SESSION_ID
}

export function sessionZoneDir(sessionId?: string | null): string {
  return join(syncZoneRoot(), zoneSessionId(sessionId))
}

export function producerDir(sessionId: string | null | undefined, producer: ArtifactProducer): string {
  return join(sessionZoneDir(sessionId), producer)
}

function withinRoot(root: string, path: string): string | null {
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel
}

/** The zone root as written and, when it exists, canonicalised — macOS `/var` → `/private/var`. */
function zoneRoots(): string[] {
  const root = resolve(syncZoneRoot())
  let real: string
  try { real = realpathSync(root) } catch { return [root] }
  return real === root ? [root] : [root, real]
}

/**
 * `<sessionId>/<relative>` for a path inside this desktop's zone, else null.
 * Textual on purpose: the path may not exist yet, and a foreign root is never
 * resolved locally (§2).
 */
export function zoneRelativePath(path: string): { sessionId: string; relativePath: string } | null {
  const abs = resolve(path)
  for (const root of zoneRoots()) {
    const rel = withinRoot(root, abs)
    if (rel === null) continue
    const [sessionId, ...rest] = rel.split(sep)
    if (!sessionId || rest.length === 0) return null
    return { sessionId, relativePath: rest.join('/') }
  }
  return null
}

const ARTIFACT_PRODUCERS: readonly ArtifactProducer[] = [
  'browser', 'computer-use', 'ios-simulator', 'android', 'ios-mirror', 'recording', 'media-gen', 'download', 'agent',
]

/**
 * Read a zone path back into the ref that produced it. The layout *is* the
 * record: a writer that was handed an output directory (a device backend, a
 * media-gen driver) does not have to carry the producer separately.
 */
export function zoneArtifactRef(path: string): { sessionId: string; producer: ArtifactProducer; relativePath: string } | null {
  const zone = zoneRelativePath(path)
  if (!zone) return null
  const [producer, ...rest] = zone.relativePath.split('/')
  if (!producer || rest.length === 0) return null
  if (!ARTIFACT_PRODUCERS.includes(producer as ArtifactProducer)) return null
  return { sessionId: zone.sessionId, producer: producer as ArtifactProducer, relativePath: zone.relativePath }
}

export function isUnderSyncZone(path: string): boolean {
  const abs = resolve(path)
  return zoneRoots().some((root) => withinRoot(root, abs) !== null)
}
