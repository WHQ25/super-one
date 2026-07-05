import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GeneratedFile } from 'ai'
import type { SavedImage } from './types'

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function extensionFor(mediaType: string): string {
  return EXT_BY_MEDIA_TYPE[mediaType] ?? 'bin'
}

export function persistImages(
  images: readonly GeneratedFile[],
  outputDir: string,
  generationId: string,
): SavedImage[] {
  mkdirSync(outputDir, { recursive: true })
  return images.map((image, index) => {
    const mediaType = image.mediaType || 'image/png'
    const filePath = join(outputDir, `${generationId}-${index}.${extensionFor(mediaType)}`)
    const tmpPath = `${filePath}.${process.pid}.tmp`
    writeFileSync(tmpPath, image.uint8Array)
    renameSync(tmpPath, filePath)
    return { path: filePath, mediaType, base64: image.base64 }
  })
}
