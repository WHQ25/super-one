import { createRequire } from 'module'
import { statSync, writeFileSync, renameSync } from 'fs'
import { dirname, extname, join, basename } from 'path'
import type { SavedImage } from './types'

const requireElectron = createRequire(import.meta.url)

/** Longest side of the preview served to the gallery thumb + agent Read path. */
export const PREVIEW_MAX_SIDE = 1280
/** Re-encode even when within pixel budget if the file is too heavy for data-URI / chat. */
export const PREVIEW_MAX_BYTES = 4 * 1024 * 1024
const PREVIEW_JPEG_QUALITY = 85

/** Minimal surface so unit tests can stub resize without loading Electron. */
export interface PreviewNativeImage {
  isEmpty: () => boolean
  getSize: () => { width: number; height: number }
  resize: (opts: { width: number; height: number; quality?: string }) => PreviewNativeImage
  toJPEG: (quality: number) => Buffer
}

export interface ImagePreviewDeps {
  createFromPath: (path: string) => PreviewNativeImage
  statSize: (path: string) => number
  writeAtomic: (path: string, data: Buffer) => void
  warn?: (message: string, ...args: unknown[]) => void
}

function defaultDeps(): ImagePreviewDeps {
  // Lazy so vitest unit tests can exercise pure helpers without loading Electron.
  const { nativeImage } = requireElectron('electron') as typeof import('electron')
  return {
    createFromPath: (path) => nativeImage.createFromPath(path) as unknown as PreviewNativeImage,
    statSize: (path) => statSync(path).size,
    writeAtomic: (path, data) => {
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, data)
      renameSync(tmp, path)
    },
    warn: (message, ...args) => {
      // Avoid importing main logger (pulls Electron) in pure unit tests.
      console.warn(message, ...args)
    },
  }
}

export function previewPathFor(originalPath: string): string {
  const dir = dirname(originalPath)
  const base = basename(originalPath, extname(originalPath))
  return join(dir, `${base}.preview.jpg`)
}

export function needsImagePreview(width: number, height: number, bytes: number): boolean {
  return Math.max(width, height) > PREVIEW_MAX_SIDE || bytes > PREVIEW_MAX_BYTES
}

/**
 * Write a downscaled JPEG next to the original when the source is large.
 * Returns the preview path (or the original path when no preview is needed / generation fails).
 */
export function writeImagePreview(originalPath: string, deps: ImagePreviewDeps = defaultDeps()): string {
  let sizeBytes: number
  try {
    sizeBytes = deps.statSize(originalPath)
  } catch {
    return originalPath
  }

  const image = deps.createFromPath(originalPath)
  if (image.isEmpty()) return originalPath

  const { width, height } = image.getSize()
  if (!needsImagePreview(width, height, sizeBytes)) return originalPath

  const longSide = Math.max(width, height)
  const scale = longSide > PREVIEW_MAX_SIDE ? PREVIEW_MAX_SIDE / longSide : 1
  const targetW = Math.max(1, Math.round(width * scale))
  const targetH = Math.max(1, Math.round(height * scale))

  try {
    const resized =
      scale < 1
        ? image.resize({ width: targetW, height: targetH, quality: 'better' })
        : image
    const jpeg = resized.toJPEG(PREVIEW_JPEG_QUALITY)
    if (!jpeg || jpeg.length === 0) return originalPath
    const outPath = previewPathFor(originalPath)
    deps.writeAtomic(outPath, Buffer.from(jpeg))
    return outPath
  } catch (err) {
    deps.warn?.('[media-gen] preview generation failed for', originalPath, err)
    return originalPath
  }
}

/** Attach `previewPath` to each saved image (reuses `path` when no downscale is needed). */
export function attachImagePreviews(images: SavedImage[], deps: ImagePreviewDeps = defaultDeps()): SavedImage[] {
  return images.map((image) => ({
    ...image,
    previewPath: writeImagePreview(image.path, deps),
  }))
}
