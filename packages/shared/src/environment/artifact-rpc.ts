/**
 * `artifact.*` — session sync zone transfer RPCs
 * (`docs/design/session-sync-zone.md` §5.2).
 *
 * All five are scoped by the node to `<syncRoot>/<sessionId>`; the zone lies
 * outside every project, so `workspace.*` cannot reach it and these must not
 * reach a project. `stat` / `list` / `get` need the controller binding only;
 * `put` / `delete` also need the session lease.
 */

/** Upload chunk size. Small enough to stay under the RPC frame budget once base64-encoded. */
export const ARTIFACT_CHUNK_BYTES = 4 * 1024 * 1024

export interface ArtifactStatRequest {
  sessionId: string
  relativePath: string
}

export interface ArtifactStatResult {
  exists: boolean
  size: number
  mtimeMs: number
}

export interface ArtifactPutRequest {
  sessionId: string
  relativePath: string
  /** Names one upload; chunks for one id arrive in order. */
  transferId: string
  /** Bytes written so far — must equal the node's count, else `conflict`. */
  offset: number
  /** Total file size; an empty file is one `final` chunk of zero bytes. */
  total: number
  /** Hex sha256 of the whole file; verified on `final` before the part is renamed into place. */
  sha256: string
  /** base64 */
  chunk: string
  final: boolean
}

export interface ArtifactPutResult {
  ok: true
  bytesWritten: number
  /** Present on the final chunk: mtime of the file now in place, so the desktop can stamp its copy to match. */
  mtimeMs?: number
}

export interface ArtifactGetRequest {
  sessionId: string
  relativePath: string
  offset: number
  maxBytes: number
}

export interface ArtifactGetResult {
  /** base64 */
  chunk: string
  total: number
  mtimeMs: number
  eof: boolean
}

export interface ArtifactDeleteRequest {
  sessionId: string
  /** Absent → the whole session directory. */
  relativePath?: string
  /** Lease proof (put/delete only). */
  leaseId?: string
  generation?: string
}

export interface ArtifactDeleteResult {
  ok: true
}

/**
 * `artifact.list` — every file under a zone directory, so the desktop can
 * mirror a directory a tool will read (a mini-app source tree) file by file.
 * Entries are session-relative and carry the same `size` + `mtimeMs` the
 * mirror compares per file. A tree past the cap is reported `truncated`,
 * and the desktop refuses to run on a partial one.
 */
export const ARTIFACT_LIST_MAX_ENTRIES = 2000

export interface ArtifactListRequest {
  sessionId: string
  relativePath: string
}

export interface ArtifactListEntry {
  relativePath: string
  size: number
  mtimeMs: number
}

export interface ArtifactListResult {
  /** False when the path is not a directory the session zone has. */
  exists: boolean
  entries: ArtifactListEntry[]
  truncated: boolean
}

export const ARTIFACT_RPC_METHODS = {
  stat: 'artifact.stat',
  list: 'artifact.list',
  put: 'artifact.put',
  get: 'artifact.get',
  delete: 'artifact.delete',
} as const
