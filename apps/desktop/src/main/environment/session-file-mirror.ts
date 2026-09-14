/**
 * Cache-through mirror of node zone artifacts on the desktop
 * (`docs/design/session-sync-zone.md` §4.2).
 *
 * A node-zone path maps by prefix to `<userData>/sync/<sessionId>/<relative>`.
 * The local copy is trusted only while its size and mtime match what
 * `artifact.stat` reports — the built-in writers rewrite `.preview.jpg` and
 * friends in place, so immutability is not something to rely on. When the
 * copy is stale or absent it is fetched with `artifact.get` into a `.part`
 * and renamed, so a concurrent reader never sees a half file.
 */
import { lstatSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { ArtifactGetRequest, ArtifactGetResult, ArtifactListRequest, ArtifactListResult, ArtifactStatResult } from '@superone/shared/environment'
import { downloadArtifact } from './artifact-transfer'
import { desktopMirrorPath, withinSessionZone } from './sync-zone-paths'
import { sessionZoneDir } from '../media-output-paths'
import { markZoneOwner } from './zone-owner'

export interface MirrorDeps {
  stat: (input: { sessionId: string; relativePath: string }) => Promise<ArtifactStatResult>
  get: (input: ArtifactGetRequest) => Promise<ArtifactGetResult>
  /** Every file under a zone directory; needed only to mirror a directory. */
  list?: (input: ArtifactListRequest) => Promise<ArtifactListResult>
  signal?: AbortSignal
  /**
   * The node being mirrored from. Recorded on the zone directory the mirror
   * writes into, so the reclaim sweep knows whom to ask about the session —
   * a directory that only ever held mirrored files used to stay unmarked.
   */
  connectionId?: string
  /**
   * Is a desktop→node upload of this file still queued? Then the desktop copy
   * is the original and the node's "not there" is just "not there yet".
   * Defaults to the transfer job table.
   */
  isPendingUpload?: (sessionId: string, relativePath: string) => boolean
}

/** The node saying the file is not there. This is the only absence it reports. */
const ABSENT_STAT_ERRORS = new Set(['not_found'])
/**
 * The node answering, but refusing. A refusal is not an absence: reporting it
 * as `missing` lets a caller fall through to whatever copy is at the desktop
 * path, which is the stale-bytes case this mirror exists to prevent.
 */
const REFUSED_STAT_ERRORS = new Set(['forbidden', 'invalid_argument', 'failed_precondition'])

async function pendingUploadInJobs(sessionId: string, relativePath: string): Promise<boolean> {
  try {
    const { listArtifactTransfersForSession } = await import('../db-artifact-transfers')
    return listArtifactTransfersForSession(sessionId).some((j) => j.relativePath === relativePath && j.state !== 'done')
  } catch {
    return false
  }
}

/** Whether a file at this relative path is a desktop original still owed to the node. */
function pendingResolver(deps: MirrorDeps, sessionId: string): (relativePath: string) => Promise<boolean> {
  return (relativePath) =>
    deps.isPendingUpload
      ? Promise.resolve(deps.isPendingUpload(sessionId, relativePath))
      : pendingUploadInJobs(sessionId, relativePath)
}

export type MirrorOutcome =
  | { kind: 'local'; path: string; size: number; mtimeMs: number }
  | { kind: 'missing' }
  /** The node has the file but would not hand it over; a caller that needs the bytes must not proceed. */
  | { kind: 'unavailable'; reason: string }

function aborted(): Error {
  return Object.assign(new Error('artifact mirror aborted'), { code: 'aborted' })
}

/** In-flight fetches keyed by desktop path so two readers of one file share a download. */
const inflight = new Map<string, Promise<MirrorOutcome>>()

function localStat(path: string): { size: number; mtimeMs: number } | null {
  try {
    const st = statSync(path)
    return st.isFile() ? { size: st.size, mtimeMs: Math.floor(st.mtimeMs) } : null
  } catch {
    return null
  }
}

/**
 * Return the desktop copy of `<sessionId>/<relativePath>`, fetching or
 * refreshing it first when the node's stat disagrees with what is on disk.
 * The node is authoritative for what exists: a file it does not have is
 * `missing` even when a copy sits here — unless that copy is a desktop
 * original whose upload is still pending, which is the one case where the
 * desktop knows better. Only an unreachable node falls back to the copy.
 */
export async function mirrorNodeArtifact(sessionId: string, relativePath: string, deps: MirrorDeps): Promise<MirrorOutcome> {
  const path = desktopMirrorPath(sessionId, relativePath)
  const existing = inflight.get(path)
  if (existing) return existing
  const work = (async (): Promise<MirrorOutcome> => {
    const local = localStat(path)
    const pendingHere = async () =>
      local && (deps.isPendingUpload ? deps.isPendingUpload(sessionId, relativePath) : await pendingUploadInJobs(sessionId, relativePath))
        ? { kind: 'local' as const, path, ...local }
        : { kind: 'missing' as const }
    let remote: ArtifactStatResult
    try {
      remote = await deps.stat({ sessionId, relativePath })
    } catch (err) {
      const code = String((err as { code?: unknown })?.code)
      if (ABSENT_STAT_ERRORS.has(code)) return pendingHere()
      if (REFUSED_STAT_ERRORS.has(code)) return { kind: 'unavailable', reason: `the node refused to stat it (${code})` }
      // Node unreachable: the local copy, if any, is the best answer there is.
      return local ? { kind: 'local', path, ...local } : { kind: 'missing' }
    }
    if (!remote.exists) return pendingHere()
    if (local && local.size === remote.size && local.mtimeMs === remote.mtimeMs) return { kind: 'local', path, ...local }
    // Mark the owner before a single `.part` is opened: a first mirror that
    // crashes mid-download must still leave a directory the reclaim sweep can
    // reason about, and an unmarked one is kept forever.
    if (deps.connectionId) markZoneOwner(sessionId, deps.connectionId)
    try {
      // The node may have replaced a file with a directory or the reverse; clear
      // a wrong-typed blocker on the way so the fetch's mkdir/open can succeed.
      reconcileMirrorType(sessionId, path)
      const fetched = await downloadArtifact({ sessionId, relativePath, destPath: path, get: deps.get, signal: deps.signal })
      return { kind: 'local', path, size: fetched.bytes, mtimeMs: fetched.mtimeMs }
    } catch (err) {
      if ((err as { code?: string }).code === 'aborted') throw err
      // The node has it and we could not get it. Saying `missing` would let a
      // caller fall through to whatever is at the desktop path.
      return { kind: 'unavailable', reason: err instanceof Error ? err.message : String(err) }
    }
  })().finally(() => inflight.delete(path))
  inflight.set(path, work)
  return work
}

/**
 * A file the node now has where the desktop has the wrong kind of thing: a
 * directory where a file should go (`downloadArtifact` would `EISDIR` opening
 * it), or a file where a parent directory should go (its `mkdir` would
 * `EEXIST`). Remove the blocker — links as links — so the fetch lands. Every
 * path here is under the session zone by construction (`desktopMirrorPath`),
 * but the check is cheap and the stakes are deletion, so it is made anyway.
 */
function reconcileMirrorType(sessionId: string, destPath: string): void {
  const zoneRoot = sessionZoneDir(sessionId)
  const segments = relative(zoneRoot, destPath).split(sep)
  let cursor = zoneRoot
  for (let i = 0; i < segments.length; i++) {
    cursor = join(cursor, segments[i]!)
    const last = i === segments.length - 1
    let st: ReturnType<typeof lstatSync>
    try {
      st = lstatSync(cursor)
    } catch {
      return // nothing here yet, nor anything below it
    }
    // A parent that is not a directory, or a leaf that is a directory, blocks
    // the fetch. A symlink is never descended into; it is removed as the link.
    const blocks = st.isSymbolicLink() || (last ? st.isDirectory() : !st.isDirectory())
    if (blocks) {
      if (!withinSessionZone(sessionId, cursor)) return
      try { rmSync(cursor, { recursive: true, force: true }) } catch { /* raced; the fetch reports the real error */ }
      return
    }
  }
}

/** How many member files are fetched at once when a directory is mirrored. */
const DIRECTORY_MIRROR_CONCURRENCY = 4

/**
 * One directory mirror at a time per session. Two mirrors of overlapping
 * directories interleaved would let an older, slower listing prune files a
 * newer one just brought down; serialising per session keeps each list →
 * fetch → prune a whole generation. Directory mirrors are rare (a mini-app
 * source tree for a dev tool), so a session-wide gate costs nothing real.
 */
const directoryMirrorChains = new Map<string, Promise<unknown>>()

/**
 * Bring a whole node directory to the desktop mirror — for a tool that will
 * *read* a directory (a mini-app source tree), which no single `stat` can
 * vouch for. The node lists it, every member goes through `mirrorNodeArtifact`
 * so each file gets the same size + mtime check, and anything under the
 * mirror the node no longer has — and the desktop does not still owe it — is
 * removed: the tool reads all of the directory, and a stale file is part of
 * "all of it". A listing the node had to truncate, or a subtree it could not
 * read, is refused as `unavailable` rather than handed over as a whole tree
 * that is not.
 */
export async function mirrorNodeDirectory(sessionId: string, relativePath: string, deps: MirrorDeps): Promise<MirrorOutcome> {
  if (!deps.list) return { kind: 'unavailable', reason: 'this node cannot list a zone directory' }
  const prior = directoryMirrorChains.get(sessionId) ?? Promise.resolve()
  const run = prior.then(
    () => mirrorDirectoryLocked(sessionId, relativePath, deps),
    () => mirrorDirectoryLocked(sessionId, relativePath, deps),
  )
  directoryMirrorChains.set(sessionId, run)
  try {
    return await run
  } finally {
    if (directoryMirrorChains.get(sessionId) === run) directoryMirrorChains.delete(sessionId)
  }
}

async function mirrorDirectoryLocked(sessionId: string, relativePath: string, deps: MirrorDeps): Promise<MirrorOutcome> {
  if (deps.signal?.aborted) throw aborted()
  let listing: ArtifactListResult
  try {
    listing = await deps.list!({ sessionId, relativePath })
  } catch (err) {
    const code = String((err as { code?: unknown })?.code)
    if (ABSENT_STAT_ERRORS.has(code)) return { kind: 'missing' }
    return { kind: 'unavailable', reason: `the node would not list it (${code})` }
  }
  if (!listing.exists) return { kind: 'missing' }
  if (listing.truncated) {
    return { kind: 'unavailable', reason: `${relativePath} has more files than one listing carries; it cannot be mirrored whole` }
  }
  // A cancel that arrived while the node was listing must stop here, before
  // anything is fetched or pruned — an empty list after an abort is not an
  // instruction to empty the directory.
  if (deps.signal?.aborted) throw aborted()
  const dir = desktopMirrorPath(sessionId, relativePath)
  // The mirror root itself must be inside this session's zone. A symlink here
  // would send the prune's `readdir` out of the zone and delete files that are
  // not the mirror's; refuse rather than follow it.
  if (!withinSessionZone(sessionId, dir)) {
    return { kind: 'unavailable', reason: `${relativePath} does not resolve inside the session zone` }
  }
  // Mark before any bytes so a crash mid-mirror still leaves a markable dir.
  if (deps.connectionId) markZoneOwner(sessionId, deps.connectionId)

  // Keep is built from what actually mirrored to a real local file, not from
  // the listing: a member the node dropped between the list and the fetch is
  // `missing`, and must fall out of the tree rather than survive because the
  // stale listing still named it.
  const keep = new Set<string>()
  const queue = [...listing.entries]
  const workers = Array.from({ length: Math.min(DIRECTORY_MIRROR_CONCURRENCY, queue.length) }, async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const outcome = await mirrorNodeArtifact(sessionId, entry.relativePath, deps)
      if (deps.signal?.aborted) throw aborted()
      if (outcome.kind === 'unavailable') throw outcome
      if (outcome.kind === 'local') keep.add(desktopMirrorPath(sessionId, entry.relativePath))
    }
  })
  try {
    await Promise.all(workers)
  } catch (err) {
    if ((err as { kind?: string }).kind === 'unavailable') return err as MirrorOutcome
    throw err
  }
  if (deps.signal?.aborted) throw aborted()
  await pruneMirroredDirectory(dir, keep, sessionId, pendingResolver(deps, sessionId))
  return { kind: 'local', path: dir, size: 0, mtimeMs: 0 }
}

/**
 * Remove every file under the mirror the node's listing did not name — unless
 * the desktop still owes it to the node (a fresh capture queued for upload,
 * which the node has not seen yet and which is the only copy). `lstat` only,
 * and links removed as links: the mirror is the desktop's own directory, but
 * deleting is still the one operation a link could redirect.
 */
async function pruneMirroredDirectory(
  dir: string,
  keep: ReadonlySet<string>,
  sessionId: string,
  isPending: (relativePath: string) => Promise<boolean>,
): Promise<void> {
  // The whole walk is refused if the directory does not resolve inside the
  // zone; every recursion re-checks, because a link could sit at any depth.
  if (!withinSessionZone(sessionId, dir)) return
  const zoneRoot = sessionZoneDir(sessionId)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    let st: ReturnType<typeof lstatSync>
    try {
      st = lstatSync(path)
    } catch {
      continue
    }
    if (st.isDirectory() && !st.isSymbolicLink()) {
      await pruneMirroredDirectory(path, keep, sessionId, isPending)
      continue
    }
    if (keep.has(path)) continue
    // A `.part.*` of a fetch still in flight belongs to that fetch.
    if (name.includes('.part.')) continue
    // A desktop original whose upload has not landed is the only copy there is.
    const rel = relative(zoneRoot, path).split(sep).join('/')
    if (await isPending(rel)) continue
    try {
      rmSync(path, { force: true })
    } catch {
      /* raced; the next mirror sees it */
    }
  }
}
