import { randomUUID } from 'node:crypto'
import { getDb } from './database'

/**
 * Persistence for session sync zone transfer jobs
 * (`docs/design/session-sync-zone.md` §5.3).
 *
 * A job is a Host Action output that did not fit inside the claim budget. It
 * belongs to a connection — like the Host Action consumer itself — and to a
 * session; the node already has the rewritten path, so the job's only duty is
 * to make that path real. Offsets are recorded as chunks land so a restart
 * resumes rather than restarts.
 */

/**
 * `uploaded` and `notifying` sit between the bytes landing and the agent being
 * told (§4.1): the row survives a failed or lost wake so it is retried, and a
 * crash in either state never re-uploads a file the node already has.
 */
export type ArtifactTransferState = 'pending' | 'running' | 'uploaded' | 'notifying' | 'done' | 'failed'

const TRANSFER_STATES: readonly ArtifactTransferState[] = ['pending', 'running', 'uploaded', 'notifying', 'done', 'failed']
/** Everything a worker still owes work on, including states a crash left behind. */
const UNFINISHED_STATES = "('pending', 'running', 'uploaded', 'notifying')"
/** Jobs whose bytes are not yet on the node — the only ones still "to be uploaded". */
const UPLOADING_STATES = "('pending', 'running')"

export interface ArtifactTransferJob {
  jobId: string
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  transferId: string
  offset: number
  total: number
  state: ArtifactTransferState
  attempts: number
  nextAttemptAt: number | null
  lastError: string | null
}

interface Row {
  job_id: string
  connection_id: string
  session_id: string
  local_path: string
  relative_path: string
  transfer_id: string
  offset: number
  total: number
  state: string
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
}

function toJob(row: Row): ArtifactTransferJob {
  return {
    jobId: row.job_id,
    connectionId: row.connection_id,
    sessionId: row.session_id,
    localPath: row.local_path,
    relativePath: row.relative_path,
    transferId: row.transfer_id,
    offset: row.offset,
    total: row.total,
    state: TRANSFER_STATES.includes(row.state as ArtifactTransferState)
      ? (row.state as ArtifactTransferState)
      : 'pending',
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at ? Date.parse(row.next_attempt_at) : null,
    lastError: row.last_error,
  }
}

export function enqueueArtifactTransfer(input: {
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  total: number
  /** The eager attempt's id, so the job resumes that transfer rather than colliding with it. */
  transferId?: string
}): ArtifactTransferJob {
  const now = new Date().toISOString()
  const job: Row = {
    job_id: randomUUID(),
    connection_id: input.connectionId,
    session_id: input.sessionId,
    local_path: input.localPath,
    relative_path: input.relativePath,
    transfer_id: input.transferId ?? randomUUID(),
    offset: 0,
    total: input.total,
    state: 'pending',
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
  }
  getDb().prepare(`
    INSERT INTO artifact_transfer_jobs
      (job_id, connection_id, session_id, local_path, relative_path, transfer_id, offset, total, state, attempts, next_attempt_at, last_error, created_at, updated_at)
    VALUES (@job_id, @connection_id, @session_id, @local_path, @relative_path, @transfer_id, @offset, @total, @state, @attempts, @next_attempt_at, @last_error, @created_at, @updated_at)
  `).run({ ...job, created_at: now, updated_at: now })
  return toJob(job)
}

/** Jobs a connection's worker should pick up: due and unfinished, including states a crash left behind. */
export function listRunnableArtifactTransfers(connectionId: string, nowMs: number): ArtifactTransferJob[] {
  const rows = getDb().prepare(`
    SELECT * FROM artifact_transfer_jobs
    WHERE connection_id = ?
      AND state IN ${UNFINISHED_STATES}
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY created_at ASC
  `).all(connectionId, new Date(nowMs).toISOString()) as Row[]
  return rows.map(toJob)
}

export function listArtifactTransfersForSession(sessionId: string): ArtifactTransferJob[] {
  const rows = getDb().prepare('SELECT * FROM artifact_transfer_jobs WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Row[]
  return rows.map(toJob)
}

/**
 * Claim a job for one attempt. False when the row is gone — its session was
 * deleted after the worker took its snapshot — so the caller skips it rather
 * than uploading for a session that no longer exists.
 */
export function markArtifactTransferRunning(jobId: string): boolean {
  return claimArtifactTransfer(jobId, 'running')
}

/** The bytes are on the node; only the agent's wake is still owed. */
export function markArtifactTransferUploaded(jobId: string): void {
  getDb().prepare(`UPDATE artifact_transfer_jobs SET state = 'uploaded', next_attempt_at = NULL, updated_at = ? WHERE job_id = ?`)
    .run(new Date().toISOString(), jobId)
}

/** Claim a job for one attempt in `state`. False when the row is gone (its session was deleted). */
export function claimArtifactTransfer(jobId: string, state: 'running' | 'notifying'): boolean {
  const result = getDb().prepare(`UPDATE artifact_transfer_jobs SET state = ?, attempts = attempts + 1, updated_at = ? WHERE job_id = ?`)
    .run(state, new Date().toISOString(), jobId)
  return result.changes === 1
}

/**
 * Jobs whose bytes are still owed to the node — `pending` or `running`, not the
 * `uploaded`/`notifying` rows whose file is already there and only the agent's
 * wake is left. This is what Settings sizes as "waiting to upload".
 */
export function listUploadingArtifactTransfers(): ArtifactTransferJob[] {
  const rows = getDb().prepare(`SELECT * FROM artifact_transfer_jobs WHERE state IN ${UPLOADING_STATES}`).all() as Row[]
  return rows.map(toJob)
}

export function listPendingArtifactTransfers(connectionId: string): ArtifactTransferJob[] {
  const rows = getDb().prepare(`
    SELECT * FROM artifact_transfer_jobs
    WHERE connection_id = ? AND state IN ${UNFINISHED_STATES}
    ORDER BY created_at ASC
  `).all(connectionId) as Row[]
  return rows.map(toJob)
}

export function recordArtifactTransferOffset(jobId: string, offset: number): void {
  getDb().prepare('UPDATE artifact_transfer_jobs SET offset = ?, updated_at = ? WHERE job_id = ?')
    .run(offset, new Date().toISOString(), jobId)
}

export function markArtifactTransferDone(jobId: string): void {
  getDb().prepare(`DELETE FROM artifact_transfer_jobs WHERE job_id = ?`).run(jobId)
}

export function markArtifactTransferFailed(
  jobId: string,
  message: string,
  nextAttemptAtMs: number | null,
  /** Where the retry resumes from; `uploaded` keeps the bytes already on the node. */
  retryState: 'pending' | 'uploaded' = 'pending',
): void {
  getDb().prepare(`UPDATE artifact_transfer_jobs SET state = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE job_id = ?`)
    .run(
      nextAttemptAtMs === null ? 'failed' : retryState,
      message.slice(0, 500),
      nextAttemptAtMs === null ? null : new Date(nextAttemptAtMs).toISOString(),
      new Date().toISOString(),
      jobId,
    )
}

/** Session deletion drops its jobs (§7). Returns the ids so an in-flight upload can be cancelled. */
export function deleteArtifactTransfersForSession(sessionId: string): string[] {
  const db = getDb()
  const ids = (db.prepare('SELECT job_id FROM artifact_transfer_jobs WHERE session_id = ?').all(sessionId) as { job_id: string }[]).map((r) => r.job_id)
  if (ids.length > 0) db.prepare('DELETE FROM artifact_transfer_jobs WHERE session_id = ?').run(sessionId)
  return ids
}
