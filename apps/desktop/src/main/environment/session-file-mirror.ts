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
import { statSync } from 'node:fs'
import type { ArtifactGetRequest, ArtifactGetResult, ArtifactStatResult } from '@superone/shared/environment'
import { downloadArtifact } from './artifact-transfer'
import { desktopMirrorPath } from './sync-zone-paths'

export interface MirrorDeps {
  stat: (input: { sessionId: string; relativePath: string }) => Promise<ArtifactStatResult>
  get: (input: ArtifactGetRequest) => Promise<ArtifactGetResult>
  signal?: AbortSignal
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

export type MirrorOutcome =
  | { kind: 'local'; path: string; size: number; mtimeMs: number }
  | { kind: 'missing' }
  /** The node has the file but would not hand it over; a caller that needs the bytes must not proceed. */
  | { kind: 'unavailable'; reason: string }

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
    try {
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
