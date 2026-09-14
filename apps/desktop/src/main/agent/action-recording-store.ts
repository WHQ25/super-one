import { ensureArtifactDir } from '../environment/zone-owner'
import { chmodSync, copyFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import log from '../logger'
import { producerDir } from '../media-output-paths'
import { publishArtifact, recordTolerantly, reserveZoneFile } from '../environment/zone-delivery'

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
  if (sessionId) recordTolerantly(path, () => reserveZoneFile({ sessionId, path, origin: 'produced' }))
  // Spoken for before the path leaves here: the helper's recorder fills it
  // over the whole action, and a directory mirror in that window must find
  // the file owned rather than prunable.
  return path
}

/** Persist a short renderer-produced action recording without putting video in tool JSON. */
export function persistActionRecording(
  sessionId: string | null | undefined,
  target: ActionRecordingTarget,
  base64: string,
  mimeType: string,
): string | null {
  try {
    const path = createActionRecordingPath(sessionId, target, extensionFor(mimeType))
    writeFileSync(path, Buffer.from(base64, 'base64'), { mode: 0o600 })
    registerRecording(sessionId, path)
    return path
  } catch (error) {
    log.warn('[action-recording] failed to persist video', error)
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

export function adoptActionRecording(
  sessionId: string | null | undefined,
  target: ActionRecordingTarget,
  sourcePath: string,
  startedAt: number,
): ActionRecording {
  const extension =
    extname(sourcePath).toLowerCase() === '.webm' ? 'webm' : 'mp4'
  const path = createActionRecordingPath(sessionId, target, extension)
  copyFileSync(sourcePath, path)
  chmodSync(path, 0o600)
  registerRecording(sessionId, path)
  return actionRecordingFromPath(path, startedAt)
}

/** Sealed the moment it is on disk: the tool reply that names it goes out next. */
function registerRecording(sessionId: string | null | undefined, path: string): void {
  if (sessionId) publishArtifact(sessionId, { path, producer: 'recording', final: true })
}
