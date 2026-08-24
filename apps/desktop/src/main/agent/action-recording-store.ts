import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import log from '../logger'

export type ActionRecordingTarget = 'web' | 'device' | 'computer'

export interface ActionRecording {
  savedPath: string
  mimeType: string
  durationMs: number
  width?: number
  height?: number
}

export function actionRecordingDir(target?: ActionRecordingTarget): string {
  const root = join(app.getPath('userData'), 'recordings')
  return target ? join(root, target) : root
}

function extensionFor(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

export function createActionRecordingPath(
  target: ActionRecordingTarget,
  extension: 'mp4' | 'webm',
): string {
  const dir = actionRecordingDir(target)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  return join(dir, `${randomUUID()}.${extension}`)
}

/** Persist a short renderer-produced action recording without putting video in tool JSON. */
export function persistActionRecording(
  target: ActionRecordingTarget,
  base64: string,
  mimeType: string,
): string | null {
  try {
    const path = createActionRecordingPath(target, extensionFor(mimeType))
    writeFileSync(path, Buffer.from(base64, 'base64'), { mode: 0o600 })
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
  target: ActionRecordingTarget,
  sourcePath: string,
  startedAt: number,
): ActionRecording {
  const extension =
    extname(sourcePath).toLowerCase() === '.webm' ? 'webm' : 'mp4'
  const path = createActionRecordingPath(target, extension)
  copyFileSync(sourcePath, path)
  chmodSync(path, 0o600)
  return actionRecordingFromPath(path, startedAt)
}
