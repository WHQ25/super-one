import type { NativeImage } from 'electron'

/** Longest side of a picture dragged out of chat, in points. */
const IMAGE_DRAG_THUMB_MAX = 160

const IMAGE_DRAG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico|tiff?)$/i

/**
 * A small copy of an image file for `webContents.startDrag`. Chat pictures
 * normally snapshot the `<img>`, but a `local-file://` preview taints the
 * canvas, so that snapshot is missing and the file icon is only a speck.
 * Returns null for non-images and for files Electron cannot decode.
 */
export function imageDragThumbnail(source: NativeImage, filePath: string): NativeImage | null {
  if (!IMAGE_DRAG_EXT.test(filePath) || source.isEmpty()) return null
  const { width, height } = source.getSize()
  if (width <= 0 || height <= 0) return null
  const scale = Math.min(1, IMAGE_DRAG_THUMB_MAX / Math.max(width, height))
  if (scale === 1) return source
  const resized = source.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'best',
  })
  return resized.isEmpty() ? null : resized
}

export interface StartDragDeps {
  exists: (p: string) => boolean
  createFromBuffer: (buf: Buffer, opts: { scaleFactor: number }) => NativeImage
  getFileIcon: (filePath: string) => Promise<NativeImage>
}

export interface StartDragPlan {
  files: string[]
  icon: NativeImage
}

export async function planStartDrag(
  paths: unknown,
  iconOpts: { png: ArrayBuffer; scaleFactor?: number } | undefined,
  deps: StartDragDeps,
): Promise<StartDragPlan | null> {
  if (!Array.isArray(paths)) return null
  const files = paths.filter((p): p is string => typeof p === 'string' && deps.exists(p))
  if (files.length === 0) return null

  let icon: NativeImage | null = null
  if (iconOpts?.png) {
    const img = deps.createFromBuffer(Buffer.from(iconOpts.png), { scaleFactor: iconOpts.scaleFactor ?? 1 })
    if (!img.isEmpty()) icon = img
  }
  if (!icon) icon = await deps.getFileIcon(files[0])
  if (icon.isEmpty()) return null

  return { files, icon }
}
