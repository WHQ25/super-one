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
}

export type MirrorOutcome =
  | { kind: 'local'; path: string; size: number; mtimeMs: number }
  | { kind: 'missing' }

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
 * A file the node does not have is `missing` — and a stale local copy of it
 * is still returned, because a desktop-produced artifact that was never
 * pushed (older node, deferred transfer) is real on this side.
 */
export async function mirrorNodeArtifact(sessionId: string, relativePath: string, deps: MirrorDeps): Promise<MirrorOutcome> {
  const path = desktopMirrorPath(sessionId, relativePath)
  const existing = inflight.get(path)
  if (existing) return existing
  const work = (async (): Promise<MirrorOutcome> => {
    const local = localStat(path)
    let remote: ArtifactStatResult
    try {
      remote = await deps.stat({ sessionId, relativePath })
    } catch {
      // Node unreachable: the local copy, if any, is the best answer there is.
      return local ? { kind: 'local', path, ...local } : { kind: 'missing' }
    }
    if (!remote.exists) return local ? { kind: 'local', path, ...local } : { kind: 'missing' }
    if (local && local.size === remote.size && local.mtimeMs === remote.mtimeMs) return { kind: 'local', path, ...local }
    const fetched = await downloadArtifact({ sessionId, relativePath, destPath: path, get: deps.get, signal: deps.signal })
    return { kind: 'local', path, size: fetched.bytes, mtimeMs: fetched.mtimeMs }
  })().finally(() => inflight.delete(path))
  inflight.set(path, work)
  return work
}
