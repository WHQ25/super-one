import { ensureArtifactDir } from '../environment/zone-owner'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import log from '../logger'
import { producerDir } from '../media-output-paths'
import { registerArtifact } from '../mcp/artifact-registry'

/**
 * Persist a large browser text/JSON result into the session's zone and return
 * the absolute path. Mirrors persistScreenshot: the model receives a path +
 * preview instead of the full blob, then reads/greps it on demand. This turns
 * an over-budget result into retrievable data rather than a hard error — which
 * is exactly why it is registered as an artifact: a remote agent must be able
 * to Read the spilled file too. Returns null if the write fails, so callers
 * can fall back to an inline reply.
 */
export function persistTextArtifact(sessionId: string | null | undefined, content: string, ext: string): string | null {
  try {
    const dir = ensureArtifactDir(producerDir(sessionId, 'browser'))
    const filePath = join(dir, `${randomUUID()}.${ext}`)
    writeFileSync(filePath, content, 'utf-8')
    registerArtifact(sessionId ?? '', { path: filePath, producer: 'browser', final: true })
    return filePath
  } catch (err) {
    log.warn('[browser-artifact] failed to persist artifact', err)
    return null
  }
}
