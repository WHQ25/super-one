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
 *
 * Every destructive step here — a type-conflict removal, a prune — runs behind
 * the same three guards, because a mirror both writes and deletes inside a
 * directory another producer may be writing to: the target must resolve inside
 * this session's zone (a link out of it is never followed), it must not be a
 * desktop original still owed to the node, and the action must not have been
 * cancelled. A directory mirror holds one generation at a time per session.
 */
import { basename, join, relative, sep } from 'node:path'
import { lstatSync, readdirSync, rmSync, statSync } from 'node:fs'
import type { ArtifactGetRequest, ArtifactGetResult, ArtifactListRequest, ArtifactListResult, ArtifactStatResult } from '@superone/shared/environment'
import { downloadArtifact } from './artifact-transfer'
import { activeWriteUnder } from './active-writes'
import { desktopMirrorPath, withinSessionZone } from './sync-zone-paths'
import { sessionZoneDir } from '../media-output-paths'
import { markZoneOwner, OWNER_FILE } from './zone-owner'

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

/**
 * Zone metadata that is not an artifact and must never be fetched, listed as a
 * member, or overwritten. `.owner` is the reclaim marker — mirroring the node's
 * copy over it would move a directory's ownership and hand it to the sweep.
 */
const RESERVED_ZONE_NAMES = new Set([OWNER_FILE, '.parts'])
function namesReservedMetadata(relativePath: string): boolean {
  return relativePath.split(/[\\/]/).some((seg) => RESERVED_ZONE_NAMES.has(seg))
}

/**
 * Why the desktop's copy of a path must not be deleted or overwritten, as of
 * when the snapshot was taken:
 *
 * - `upload` — a *complete* desktop original whose bytes the node does not
 *   have. It is the newest version of that file anywhere, so the mirror serves
 *   it as well as protecting it.
 * - `writing` — a producer on this desktop is still filling it. Protected the
 *   same way, but never served: half a file is not an input, and the caller
 *   would hand the agent a path to a truncated download.
 */
type ProtectedReason = 'upload' | 'writing' | null
type PendingSnapshot = (desktopPath: string) => ProtectedReason

/**
 * Job states whose bytes are not on the node yet.
 *
 * `uploaded` and `notifying` are deliberately absent: the file is already
 * there and the row is only waiting on the completion wake, so the desktop
 * copy is not authoritative — the agent may have changed the file on the node
 * since, and serving ours would hand back the version it replaced.
 * `failed` IS present: a failed upload means the node never got the bytes.
 */
const OWED_TO_NODE = new Set(['pending', 'running', 'failed'])

/**
 * A file this desktop is producing, translated into the mirror's vocabulary. A
 * sealed write is complete and is the only copy, which is the same standing as
 * a queued upload; an unsealed one is protected but must not be served.
 */
function stageOf(sessionId: string, path: string): ProtectedReason {
  const stage = activeWriteUnder(sessionId, path)
  return stage === 'writing' ? 'writing' : stage === 'sealed' ? 'upload' : null
}

/**
 * Takes a *fresh* synchronous view of the pending originals on demand.
 *
 * Freshness is the whole point: a capture another Host Action produced and
 * queued while this mirror was mid-download is the only copy of that file, and
 * a snapshot taken before the first fetch does not know about it. The module
 * load is the only `await`, done once up front, so every destructive step can
 * read the table synchronously at the moment it acts — no `await` between
 * deciding to delete or overwrite and doing it.
 */
interface PendingSource {
  snapshot(): PendingSnapshot
}

async function pendingSource(sessionId: string, deps: MirrorDeps): Promise<PendingSource> {
  const zoneRoot = sessionZoneDir(sessionId)
  const relOf = (p: string) => relative(zoneRoot, p).split(sep).join('/')
  if (deps.isPendingUpload) {
    return {
      snapshot: () => (p) => stageOf(sessionId, p) ?? (deps.isPendingUpload!(sessionId, relOf(p)) ? 'upload' : null),
    }
  }
  let list: ((id: string) => { relativePath: string; state: string }[]) | null = null
  try {
    list = (await import('../db-artifact-transfers')).listArtifactTransfersForSession
  } catch {
    /* no job table: nothing is protected beyond what is on disk */
  }
  return {
    snapshot: () => {
      const rels = new Set<string>()
      try {
        for (const j of list?.(sessionId) ?? []) if (OWED_TO_NODE.has(j.state)) rels.add(j.relativePath)
      } catch {
        /* unreadable table: fall through to "nothing pending" */
      }
      // Writers first: a file still being filled has no job row at all, which
      // is the whole reason the in-process registry exists.
      return (p) => stageOf(sessionId, p) ?? (rels.has(relOf(p)) ? 'upload' : null)
    },
  }
}

export type MirrorOutcome =
  | { kind: 'local'; path: string; size: number; mtimeMs: number }
  | { kind: 'missing' }
  /** The node has the file but it cannot be placed safely; a caller that needs the bytes must not proceed. */
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
  if (namesReservedMetadata(relativePath)) return { kind: 'missing' }
  const path = desktopMirrorPath(sessionId, relativePath)
  const existing = inflight.get(path)
  if (existing) return existing
  const work = mirrorOneArtifact(sessionId, relativePath, path, deps).finally(() => inflight.delete(path))
  inflight.set(path, work)
  return work
}

async function mirrorOneArtifact(
  sessionId: string,
  relativePath: string,
  path: string,
  deps: MirrorDeps,
  source?: PendingSource,
): Promise<MirrorOutcome> {
  const outside = (): MirrorOutcome => ({ kind: 'unavailable', reason: `${relativePath} resolves outside the session zone` })
  // Before anything is read OR written: a path that resolves out of the zone is
  // not this mirror's to serve either. A cached copy behind a planted link is
  // still a file from outside, and the callers hand the path straight on.
  if (!withinSessionZone(sessionId, path)) return outside()
  const pending = source ?? (await pendingSource(sessionId, deps))
  const local = localStat(path)
  const incomplete = (): MirrorOutcome => ({ kind: 'unavailable', reason: `${relativePath} is still being written on this desktop` })
  /**
   * Every `local` answer goes through here, so both refusals are stated once:
   * the boundary is re-checked because a link can be planted mid-flight, and a
   * file a producer is still filling is never handed over — including on the
   * offline fallback, where there is no node answer to weigh it against.
   */
  const serveLocal = (st: { size: number; mtimeMs: number }): MirrorOutcome => {
    if (!withinSessionZone(sessionId, path)) return outside()
    if (activeWriteUnder(sessionId, path) === 'writing') return incomplete()
    return { kind: 'local', path, size: st.size, mtimeMs: st.mtimeMs }
  }
  /** What the desktop has when the node does not have the file. */
  const pendingHere = (): MirrorOutcome =>
    local && pending.snapshot()(path) ? serveLocal(local) : { kind: 'missing' }
  let remote: ArtifactStatResult
  try {
    remote = await deps.stat({ sessionId, relativePath })
  } catch (err) {
    const code = String((err as { code?: unknown })?.code)
    if (ABSENT_STAT_ERRORS.has(code)) return pendingHere()
    if (REFUSED_STAT_ERRORS.has(code)) return { kind: 'unavailable', reason: `the node refused to stat it (${code})` }
    // Node unreachable: the local copy, if any, is the best answer there is.
    return local ? serveLocal(local) : { kind: 'missing' }
  }
  if (!remote.exists) return pendingHere()
  // A desktop original still owed to the node is newer than anything the node
  // can have; overwriting it with the node's older copy destroys the only one.
  // A file still being written is protected the same way but is not an answer.
  if (local && pending.snapshot()(path)) return serveLocal(local)
  if (local && local.size === remote.size && local.mtimeMs === remote.mtimeMs) return serveLocal(local)
  // The stat was an await: a cancel may have arrived, and the destructive
  // reconcile below must not run past it (a deleted directory does not come
  // back when the fetch then throws aborted).
  if (deps.signal?.aborted) throw aborted()
  if (!withinSessionZone(sessionId, path)) return outside()
  // Mark the owner before a single `.part` is opened: a first mirror that
  // crashes mid-download must still leave a directory the reclaim sweep can
  // reason about, and an unmarked one is kept forever.
  if (deps.connectionId) markZoneOwner(sessionId, deps.connectionId)
  const reconciled = reconcileMirrorType(sessionId, path, pending.snapshot(), deps.signal)
  if (reconciled === 'conflict') {
    return { kind: 'unavailable', reason: `${relativePath} cannot be placed: a desktop original or an out-of-zone link is in the way` }
  }
  try {
    const fetched = await downloadArtifact({
      sessionId,
      relativePath,
      destPath: path,
      get: deps.get,
      signal: deps.signal,
      // The last word, synchronously, immediately before the rename: the whole
      // download was an await, and a producer may have written and queued the
      // real original at this path while it ran.
      beforeCommit: () => {
        if (deps.signal?.aborted) throw aborted()
        const why = pending.snapshot()(path)
        if (why) {
          const reason =
            why === 'writing'
              ? `${relativePath} is being written on this desktop`
              : `${relativePath} was produced here and is still owed to the node`
          throw Object.assign(new Error(reason), { code: 'conflict' })
        }
        if (!withinSessionZone(sessionId, path)) {
          throw Object.assign(new Error(`${relativePath} resolves outside the session zone`), { code: 'conflict' })
        }
      },
    })
    return { kind: 'local', path, size: fetched.bytes, mtimeMs: fetched.mtimeMs }
  } catch (err) {
    if ((err as { code?: string }).code === 'aborted') throw err
    // The node has it and we could not get it. Saying `missing` would let a
    // caller fall through to whatever is at the desktop path.
    return { kind: 'unavailable', reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * A file the node now has where the desktop has the wrong kind of thing: a
 * directory where a file should go (`downloadArtifact` would `EISDIR` opening
 * it), or a file where a parent directory should go (its `mkdir` would
 * `EEXIST`). The blocker is removed so the fetch can land — but never when
 * doing so would delete a desktop original still owed to the node, or follow a
 * link out of the zone: those are `conflict`, and the fetch is refused instead.
 */
function reconcileMirrorType(
  sessionId: string,
  destPath: string,
  isPending: PendingSnapshot,
  signal?: AbortSignal,
): 'clear' | 'conflict' {
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
      return 'clear' // nothing here yet, nor anything below it
    }
    // A parent that is not a directory, or a leaf that is a directory, blocks
    // the fetch. A symlink is never descended into; it is removed as the link.
    const blocks = st.isSymbolicLink() || (last ? st.isDirectory() : !st.isDirectory())
    if (!blocks) continue
    if (signal?.aborted) throw aborted()
    // The link, or what it points at, is outside the zone: not ours to remove.
    if (!withinSessionZone(sessionId, cursor)) return 'conflict'
    // The blocker (or a file under it) is a desktop original still owed to the
    // node, or a fetch in progress: deleting it would lose the only copy.
    if (subtreeHasProtectedFile(cursor, isPending)) return 'conflict'
    try {
      rmSync(cursor, { recursive: true, force: true })
    } catch {
      return 'conflict'
    }
    return 'clear'
  }
  return 'clear'
}

/** Does `path`, or any file under it, still owe an upload or belong to a running fetch? `lstat` only. */
function subtreeHasProtectedFile(path: string, isPending: PendingSnapshot): boolean {
  let st: ReturnType<typeof lstatSync>
  try {
    st = lstatSync(path)
  } catch {
    return false
  }
  if (st.isSymbolicLink()) return false
  if (st.isFile()) return basename(path).includes('.part.') || isPending(path) !== null
  if (st.isDirectory()) {
    let names: string[]
    try {
      names = readdirSync(path)
    } catch {
      // Cannot see inside it — assume it holds something worth keeping rather
      // than delete blind.
      return true
    }
    return names.some((name) => subtreeHasProtectedFile(join(path, name), isPending))
  }
  return false
}

/** How many member files are fetched at once when a directory is mirrored. */
const DIRECTORY_MIRROR_CONCURRENCY = 4

/**
 * One directory mirror at a time per session, and the *whole* of it — every
 * member fetch drained — before the next runs. Two mirrors of overlapping
 * directories interleaved would let an older, slower listing prune files a
 * newer one just brought down, or let a worker a failed mirror abandoned write
 * into the tree a later mirror produced. Directory mirrors are rare (a mini-app
 * source tree for a dev tool), so a session-wide gate costs nothing real.
 */
const directoryMirrorChains = new Map<string, Promise<unknown>>()

/**
 * Bring a whole node directory to the desktop mirror — for a tool that will
 * *read* a directory (a mini-app source tree), which no single `stat` can
 * vouch for. The node lists it, every member goes through the same per-file
 * fetch, and anything under the mirror the node no longer has — and the
 * desktop does not still owe it — is removed. A listing the node had to
 * truncate, a subtree it could not read, a member that cannot be placed
 * safely, or a cancel is refused as `unavailable`/`aborted` rather than
 * handed over as a whole tree that is not.
 */
export async function mirrorNodeDirectory(sessionId: string, relativePath: string, deps: MirrorDeps): Promise<MirrorOutcome> {
  if (!deps.list) return { kind: 'unavailable', reason: 'this node cannot list a zone directory' }
  if (namesReservedMetadata(relativePath)) return { kind: 'unavailable', reason: `${relativePath} is reserved metadata, not a directory to mirror` }
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

  const pending = await pendingSource(sessionId, deps)
  // Reading the job table was an await of its own; a cancel during it raises no
  // further event, so the batch below would start with a signal that looks live.
  if (deps.signal?.aborted) throw aborted()
  // The batch is cancelled as one: a member that cannot be placed, or the
  // caller's own abort, stops every worker — and every worker is awaited before
  // this returns, so a fetch a failed batch abandoned cannot outlive it and
  // land in a later mirror's tree.
  const batch = new AbortController()
  // Carried over synchronously: an abort that already fired never fires again.
  if (deps.signal?.aborted) batch.abort()
  const relayAbort = () => batch.abort()
  deps.signal?.addEventListener('abort', relayAbort, { once: true })
  const workerDeps: MirrorDeps = { ...deps, signal: batch.signal }
  const keep = new Set<string>()
  let failure: MirrorOutcome | Error | null = null
  const queue = [...listing.entries]
  const worker = async (): Promise<void> => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      if (batch.signal.aborted) return
      let outcome: MirrorOutcome
      try {
        outcome = await mirrorNodeArtifactWithin(sessionId, entry.relativePath, workerDeps, pending)
      } catch (err) {
        failure ??= err as Error
        batch.abort()
        return
      }
      if (outcome.kind === 'unavailable') {
        failure ??= outcome
        batch.abort()
        return
      }
      if (outcome.kind === 'local') keep.add(desktopMirrorPath(sessionId, entry.relativePath))
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(DIRECTORY_MIRROR_CONCURRENCY, queue.length) || 1 }, worker))
  } finally {
    deps.signal?.removeEventListener('abort', relayAbort)
  }
  // The caller's cancel wins over any member failure it caused.
  if (deps.signal?.aborted) throw aborted()
  // Read through an explicit widening: the assignments happen inside the worker
  // closures, which control-flow analysis does not follow, so `failure` would
  // otherwise still be typed as its `null` initialiser here.
  const failed = failure as MirrorOutcome | Error | null
  if (failed) {
    if (failed instanceof Error) throw failed
    return failed
  }
  // A snapshot taken now, not before the fetches: a capture another Host Action
  // queued while they ran is the only copy of that file.
  pruneMirroredDirectory(dir, keep, sessionId, pending.snapshot(), deps.signal)
  // A directory is handed to its caller as a unit — `miniapp_dev_pack` reads
  // the whole tree — so one half-written member makes the whole answer wrong.
  // The prune correctly KEEPS that file; keeping it and then calling the tree
  // complete are different questions, and only the first was answered.
  if (activeWriteUnder(sessionId, dir) === 'writing') {
    return { kind: 'unavailable', reason: `${relativePath} holds a file this desktop is still writing` }
  }
  return { kind: 'local', path: dir, size: 0, mtimeMs: 0 }
}

/** A directory-mirror member fetch, sharing the batch's pending snapshot and never re-deduped as reserved. */
function mirrorNodeArtifactWithin(
  sessionId: string,
  relativePath: string,
  deps: MirrorDeps,
  pending: PendingSource,
): Promise<MirrorOutcome> {
  if (namesReservedMetadata(relativePath)) return Promise.resolve({ kind: 'missing' })
  const path = desktopMirrorPath(sessionId, relativePath)
  const existing = inflight.get(path)
  if (existing) return existing
  const work = mirrorOneArtifact(sessionId, relativePath, path, deps, pending).finally(() => inflight.delete(path))
  inflight.set(path, work)
  return work
}

/**
 * Remove every file under the mirror the node's listing did not name — unless
 * the desktop still owes it to the node (a fresh capture queued for upload,
 * which the node has not seen yet and which is the only copy). Synchronous:
 * the pending set is snapshotted before the walk, so nothing is `await`ed
 * between deciding to delete and deleting. `lstat` only, and links removed as
 * links; the boundary and the cancel are re-checked at every level and before
 * every delete.
 */
function pruneMirroredDirectory(
  dir: string,
  keep: ReadonlySet<string>,
  sessionId: string,
  isPending: PendingSnapshot,
  signal?: AbortSignal,
): void {
  if (signal?.aborted) throw aborted()
  // Refused if the directory does not resolve inside the zone; re-checked at
  // every recursion, because a link could sit at any depth.
  if (!withinSessionZone(sessionId, dir)) return
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (signal?.aborted) throw aborted()
    const path = join(dir, name)
    let st: ReturnType<typeof lstatSync>
    try {
      st = lstatSync(path)
    } catch {
      continue
    }
    if (st.isDirectory() && !st.isSymbolicLink()) {
      pruneMirroredDirectory(path, keep, sessionId, isPending, signal)
      continue
    }
    if (keep.has(path)) continue
    // A `.part.*` of a fetch still in flight belongs to that fetch; `.owner` is
    // the reclaim marker, never a mirrored artifact.
    if (name.includes('.part.') || RESERVED_ZONE_NAMES.has(name)) continue
    // A desktop original whose upload has not landed, or a file a producer here
    // is still writing, is the only copy there is.
    if (isPending(path)) continue
    // `dir` was re-checked in the zone at this recursion\'s entry and the walk
    // holds no `await`, so nothing swaps it under us; a stale link here is
    // removed as the link, never followed to its target.
    try {
      rmSync(path, { force: true })
    } catch {
      /* raced; the next mirror sees it */
    }
  }
}
