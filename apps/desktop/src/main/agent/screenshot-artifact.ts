import { createRequire } from 'module'
import { mkdirSync, writeFileSync, renameSync, statSync } from 'fs'
import { join, dirname, basename, extname } from 'path'
import { randomUUID } from 'crypto'

/**
 * Shared screenshot artifact helpers for browser + Computer Use.
 *
 * - Persist base64 → fixed directory path (tool returns path, not pixels)
 * - When file is too heavy for agent Read: JPEG re-encode at same dimensions
 *   (media-gen/image-preview pattern; no resize so coordinate spaces stay valid)
 *
 * Avoids importing main logger so unit tests stay free of the Electron CJS graph
 * until optimize actually needs nativeImage.
 */

/** Re-encode when heavier than this (dimensions unchanged). */
export const AGENT_SCREENSHOT_MAX_BYTES = 1.5 * 1024 * 1024
const AGENT_JPEG_QUALITY = 82

export interface AgentNativeImage {
  isEmpty: () => boolean
  getSize: () => { width: number; height: number }
  resize: (opts: { width: number; height: number; quality?: string }) => AgentNativeImage
  toJPEG: (quality: number) => Buffer
  toPNG: () => Buffer
}

export interface ScreenshotArtifactDeps {
  createFromBuffer: (buf: Buffer) => AgentNativeImage
  createFromPath: (path: string) => AgentNativeImage
  statSize: (path: string) => number
  writeAtomic: (path: string, data: Buffer) => void
}

export interface PersistedScreenshotArtifact {
  path: string
  width: number
  height: number
  mimeType: string
  bytes: number
  /** True when we re-encoded for the agent (sibling *.agent.jpg). */
  optimized: boolean
}

const requireElectron = createRequire(import.meta.url)

function defaultDeps(): ScreenshotArtifactDeps {
  const { nativeImage } = requireElectron('electron') as typeof import('electron')
  return {
    createFromBuffer: (buf) => nativeImage.createFromBuffer(buf) as unknown as AgentNativeImage,
    createFromPath: (path) => nativeImage.createFromPath(path) as unknown as AgentNativeImage,
    statSize: (path) => statSync(path).size,
    writeAtomic: (path, data) => {
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, data)
      renameSync(tmp, path)
    },
  }
}

export function needsAgentScreenshotOptimize(_width: number, _height: number, bytes: number): boolean {
  return bytes > AGENT_SCREENSHOT_MAX_BYTES
}

function optimizedPathFor(originalPath: string): string {
  const dir = dirname(originalPath)
  const base = basename(originalPath, extname(originalPath))
  return join(dir, `${base}.agent.jpg`)
}

/**
 * JPEG re-encode at the same pixel size when the file is too heavy for agent Read.
 */
export function writeOptimizedAgentScreenshot(
  originalPath: string,
  width: number,
  height: number,
  deps?: ScreenshotArtifactDeps,
): { path: string; width: number; height: number; bytes: number } | null {
  const resolved = deps ?? defaultDeps()
  try {
    const image = resolved.createFromPath(originalPath)
    if (image.isEmpty()) return null

    const size = image.getSize()
    const srcW = size.width || width
    const srcH = size.height || height
    if (srcW <= 0 || srcH <= 0) return null

    let bytes: number
    try {
      bytes = resolved.statSize(originalPath)
    } catch {
      return null
    }

    if (!needsAgentScreenshotOptimize(srcW, srcH, bytes)) {
      return { path: originalPath, width: srcW, height: srcH, bytes }
    }

    const jpeg = image.toJPEG(AGENT_JPEG_QUALITY)
    if (!jpeg || jpeg.length === 0) return null

    const outPath = optimizedPathFor(originalPath)
    resolved.writeAtomic(outPath, Buffer.from(jpeg))
    return {
      path: outPath,
      width: srcW,
      height: srcH,
      bytes: jpeg.length,
    }
  } catch {
    return null
  }
}

/**
 * Write base64 image under `dir`, then optimize for agent Read when oversized.
 */
export function persistBase64Screenshot(
  dir: string,
  base64: string,
  mimeType: string = 'image/png',
  declared?: { width?: number; height?: number },
  deps?: ScreenshotArtifactDeps,
): PersistedScreenshotArtifact | null {
  try {
    mkdirSync(dir, { recursive: true })
    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png'
    const originalPath = join(dir, `${randomUUID()}.${ext}`)
    const raw = Buffer.from(base64, 'base64')
    writeFileSync(originalPath, raw)

    let width = declared?.width ?? 0
    let height = declared?.height ?? 0
    let bytes = raw.length
    let path = originalPath
    let outMime = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'image/jpeg' : 'image/png'
    let optimized = false

    const maybeHeavy = needsAgentScreenshotOptimize(width || 1, height || 1, bytes)
    const resolved = deps ?? (maybeHeavy ? defaultDeps() : null)
    if (resolved) {
      try {
        const img = resolved.createFromBuffer(raw)
        if (!img.isEmpty()) {
          const size = img.getSize()
          width = size.width || width
          height = size.height || height
        }
      } catch {
        // keep declared
      }
      try {
        bytes = resolved.statSize(originalPath)
      } catch {
        // keep buffer length
      }
    }

    if (needsAgentScreenshotOptimize(width || 1, height || 1, bytes)) {
      const optimizedResult = writeOptimizedAgentScreenshot(
        originalPath,
        width || 1,
        height || 1,
        resolved ?? defaultDeps(),
      )
      if (optimizedResult && optimizedResult.path !== originalPath) {
        path = optimizedResult.path
        width = optimizedResult.width
        height = optimizedResult.height
        bytes = optimizedResult.bytes
        outMime = 'image/jpeg'
        optimized = true
      }
    }

    return { path, width, height, mimeType: outMime, bytes, optimized }
  } catch {
    return null
  }
}
