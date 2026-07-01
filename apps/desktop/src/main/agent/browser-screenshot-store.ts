import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import log from '../logger'

const SCREENSHOT_DIR = join(tmpdir(), 'super-one-browser-screenshots')

/**
 * Persist a browser screenshot's base64 image to a temp file and return the
 * absolute path. The path (not the image) is what the tool returns to the model,
 * so a text-only agent can Read it on demand instead of forcing pixels into
 * every model's context. Returns null if the write fails.
 */
export function persistScreenshot(base64: string, mimeType: string): string | null {
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true })
    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png'
    const filePath = join(SCREENSHOT_DIR, `${randomUUID()}.${ext}`)
    writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return filePath
  } catch (err) {
    log.warn('[browser-screenshot] failed to persist screenshot', err)
    return null
  }
}
