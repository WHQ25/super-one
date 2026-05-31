import type { NativeImage } from 'electron'

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
