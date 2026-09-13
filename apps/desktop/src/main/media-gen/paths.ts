import { app } from 'electron'
import { join } from 'path'
import { producerDir } from '../media-output-paths'

export function mediaGenRoot(): string {
  return join(app.getPath('userData'), 'media-gen')
}

/**
 * Where generations landed before the session sync zone: `<userData>/media-gen/outputs/<sessionId>`.
 * Read-only now — saved transcripts still link images here by absolute path.
 */
export function mediaGenOutputRoot(): string {
  return join(mediaGenRoot(), 'outputs')
}

/** Generated media is a session artifact: `<zone>/<sessionId>/media-gen`. */
export function mediaGenOutputDir(sessionId?: string): string {
  return producerDir(sessionId, 'media-gen')
}

export function mediaGenKeysPath(): string {
  return join(mediaGenRoot(), 'keys.bin')
}
