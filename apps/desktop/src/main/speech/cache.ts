import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

export interface StoredSpeechClip {
  mediaType: string
  bytes: Uint8Array
}

function cacheRoot(): string {
  return join(app.getPath('userData'), 'speech-cache')
}

function directoryFor(messageId: string, root: string): string {
  return join(root, createHash('sha256').update(messageId).digest('hex'))
}

/** Keep the last read-aloud for a chat message so it can play again without synthesizing. */
export async function writeSpeechCache(messageId: string, clips: StoredSpeechClip[], root = cacheRoot()): Promise<void> {
  if (!messageId || clips.length === 0) return
  const dir = directoryFor(messageId, root)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const manifest = clips.map((clip, index) => ({ file: String(index), mediaType: clip.mediaType }))
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
  await Promise.all(clips.map((clip, index) => writeFile(join(dir, String(index)), clip.bytes)))
}

export async function readSpeechCache(messageId: string, root = cacheRoot()): Promise<StoredSpeechClip[] | null> {
  if (!messageId) return null
  try {
    const dir = directoryFor(messageId, root)
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { file?: unknown; mediaType?: unknown }[]
    if (!Array.isArray(manifest)) return null
    const clips: StoredSpeechClip[] = []
    for (const item of manifest) {
      if (typeof item.file !== 'string' || !/^\d+$/.test(item.file)) continue
      const mediaType = typeof item.mediaType === 'string' ? item.mediaType : 'application/octet-stream'
      const bytes = new Uint8Array(await readFile(join(dir, item.file)))
      clips.push({ mediaType, bytes })
    }
    return clips.length > 0 ? clips : null
  } catch {
    return null
  }
}

/** Remove saved read-aloud audio for these messages. Missing directories are ignored. */
export async function deleteSpeechCache(messageIds: readonly string[], root = cacheRoot()): Promise<void> {
  await Promise.all(messageIds.filter(Boolean).map((messageId) => rm(directoryFor(messageId, root), { recursive: true, force: true })))
}

export async function hasSpeechCache(messageId: string, root = cacheRoot()): Promise<boolean> {
  if (!messageId) return false
  try {
    await access(join(directoryFor(messageId, root), 'manifest.json'))
    return true
  } catch {
    return false
  }
}
