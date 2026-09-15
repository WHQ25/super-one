import { ensureArtifactDir } from '../environment/zone-owner'
import { chmodSync, copyFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import log from '../logger'
import { producerDir, zoneRelativePath } from '../media-output-paths'
import { abandonZoneFile, publishArtifact, reserveZoneFile } from '../environment/zone-delivery'

export type ActionRecordingTarget = 'web' | 'device' | 'computer'

export interface ActionRecording {
  savedPath: string
  mimeType: string
  durationMs: number
  width?: number
  height?: number
}

/**
 * Recordings live in the session sync zone, partitioned by which surface was
 * recorded (`docs/design/session-sync-zone.md` §6). The agent is handed
 * `savedPath` in the tool reply, so on a remote node the file has to be
 * somewhere the executor can push and rewrite; a recording taken with no
 * session goes to `adhoc`, which is never pushed and never auto-reclaimed.
 */
export function actionRecordingDir(sessionId: string | null | undefined, target?: ActionRecordingTarget): string {
  const root = producerDir(sessionId, 'recording')
  return target ? join(root, target) : root
}

function extensionFor(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

export function createActionRecordingPath(
  sessionId: string | null | undefined,
  target: ActionRecordingTarget,
  extension: 'mp4' | 'webm',
): string {
  const dir = ensureArtifactDir(actionRecordingDir(sessionId, target), 0o700)
  chmodSync(dir, 0o700)
  const path = join(dir, `${randomUUID()}.${extension}`)
  // Spoken for before the path leaves here: the helper's recorder fills it
  // over the whole action, and a directory mirror in that window must find
  // the file owned rather than prunable. A refusal is the recording's failure.
  if (sessionId) reserveZoneFile({ sessionId, path, origin: 'produced' })
  return path
}

/** Persist a short renderer-produced action recording without putting video in tool JSON. */
export function persistActionRecording(
  sessionId: string | null | undefined,
  target: ActionRecordingTarget,
  base64: string,
  mimeType: string,
): string | null {
  let path: string | null = null
  try {
    path = createActionRecordingPath(sessionId, target, extensionFor(mimeType))
    writeFileSync(path, Buffer.from(base64, 'base64'), { mode: 0o600 })
    registerRecording(sessionId, path)
    return path
  } catch (error) {
    log.warn('[action-recording] failed to persist video', error)
    if (path) abandonActionRecording(sessionId, path)
    return null
  }
}

export function actionRecordingFromPath(
  path: string,
  startedAt: number,
): ActionRecording {
  return {
    savedPath: path,
    mimeType:
      extname(path).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4',
    durationMs: Math.max(0, Date.now() - startedAt),
  }
}

/**
 * Take a recording a device surface produced. One the surface already put in
 * this session's zone — and sealed, under its own delivery — is registered
 * where it lies: copying it would make a second delivery of the same bytes,
 * and leave the first for a worker to send to nobody. Anything else (a
 * surface with an injected capture root) is copied into the recording
 * directory under a reservation of its own.
 */
export function adoptActionRecording(
  sessionId: string | null | undefined,
  target: ActionRecordingTarget,
  sourcePath: string,
  startedAt: number,
): ActionRecording {
  if (sessionId && zoneRelativePath(sourcePath)?.sessionId === sessionId) {
    registerRecording(sessionId, sourcePath)
    return actionRecordingFromPath(sourcePath, startedAt)
  }
  const extension =
    extname(sourcePath).toLowerCase() === '.webm' ? 'webm' : 'mp4'
  const path = createActionRecordingPath(sessionId, target, extension)
  try {
    copyFileSync(sourcePath, path)
    chmodSync(path, 0o600)
    registerRecording(sessionId, path)
  } catch (error) {
    // The factory spoke for the destination; a source that is not there must
    // give it back, or a live holder guards an empty path until the process ends.
    abandonActionRecording(sessionId, path)
    throw error
  }
  return actionRecordingFromPath(path, startedAt)
}

/**
 * The recording the factory reserved a path for is not going to exist: the
 * helper never started, the action failed, the source was missing. Every
 * consumer of `createActionRecordingPath` has to reach this on its failure
 * exits; the reservation does not time out on its own.
 */
export function abandonActionRecording(sessionId: string | null | undefined, path: string): void {
  if (sessionId) abandonZoneFile(sessionId, path)
}

/** Sealed the moment it is on disk: the tool reply that names it goes out next. */
function registerRecording(sessionId: string | null | undefined, path: string): void {
  if (sessionId) publishArtifact(sessionId, { path, producer: 'recording', final: true })
}
