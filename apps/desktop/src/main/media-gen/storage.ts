import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { GeneratedFile } from 'ai'
import type { SavedImage } from './types'

const IMAGE_EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const VIDEO_EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/**
 * Write generated files to disk atomically (tmp + rename), so a crashed or concurrent run can never
 * leave a half-written file behind that a later read would treat as complete.
 */
function persistFiles(
  files: readonly GeneratedFile[],
  outputDir: string,
  generationId: string,
  extByMediaType: Record<string, string>,
  fallbackMediaType: string,
  withBase64: boolean,
): SavedImage[] {
  mkdirSync(outputDir, { recursive: true })
  return files.map((file, index) => {
    const mediaType = file.mediaType || fallbackMediaType
    const extension = extByMediaType[mediaType] ?? 'bin'
    const filePath = join(outputDir, `${generationId}-${index}.${extension}`)
    const tmpPath = `${filePath}.${process.pid}.tmp`
    writeFileSync(tmpPath, file.uint8Array)
    renameSync(tmpPath, filePath)
    return { path: filePath, mediaType, ...(withBase64 ? { base64: file.base64 } : {}) }
  })
}

export function persistImages(
  images: readonly GeneratedFile[],
  outputDir: string,
  generationId: string,
): SavedImage[] {
  return persistFiles(images, outputDir, generationId, IMAGE_EXT_BY_MEDIA_TYPE, 'image/png', true)
}

/**
 * Videos deliberately skip the base64 copy an image keeps: a single clip runs to tens of megabytes
 * and nothing downstream reads it — the renderer plays the file from disk.
 */
export function persistVideos(
  videos: readonly GeneratedFile[],
  outputDir: string,
  generationId: string,
): SavedImage[] {
  return persistFiles(videos, outputDir, generationId, VIDEO_EXT_BY_MEDIA_TYPE, 'video/mp4', false)
}
