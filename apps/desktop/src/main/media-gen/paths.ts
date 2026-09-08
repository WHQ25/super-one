import { app } from 'electron'
import { join } from 'path'

export function mediaGenRoot(): string {
  return join(app.getPath('userData'), 'media-gen')
}

export function mediaGenOutputRoot(): string {
  return join(mediaGenRoot(), 'outputs')
}

export function mediaGenOutputDir(sessionId?: string): string {
  return join(mediaGenOutputRoot(), sessionId && sessionId.length > 0 ? sessionId : 'adhoc')
}

export function mediaGenKeysPath(): string {
  return join(mediaGenRoot(), 'keys.bin')
}
