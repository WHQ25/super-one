import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import log from '../logger'

const ARTIFACT_DIR = join(tmpdir(), 'super-one-browser-artifacts')

/**
 * Persist a large browser text/JSON result to a temp file and return the
 * absolute path. Mirrors persistScreenshot: the model receives a path + preview
 * instead of the full blob, then reads/greps it on demand. This turns an
 * over-budget result into retrievable data rather than a hard error. Returns
 * null if the write fails, so callers can fall back to an inline reply.
 */
export function persistTextArtifact(content: string, ext: string): string | null {
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true })
    const filePath = join(ARTIFACT_DIR, `${randomUUID()}.${ext}`)
    writeFileSync(filePath, content, 'utf-8')
    return filePath
  } catch (err) {
    log.warn('[browser-artifact] failed to persist artifact', err)
    return null
  }
}
