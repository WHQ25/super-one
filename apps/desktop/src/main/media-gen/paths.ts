import { app } from 'electron'
import { join } from 'path'

export function mediaGenRoot(): string {
  return join(app.getPath('userData'), 'media-gen')
}

export function mediaGenOutputDir(sessionId?: string): string {
  return join(mediaGenRoot(), 'outputs', sessionId && sessionId.length > 0 ? sessionId : 'adhoc')
}

export function mediaGenKeysPath(): string {
  return join(mediaGenRoot(), 'keys.bin')
}
