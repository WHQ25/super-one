import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { persistScreenshot, persistScreenshotArtifact, BROWSER_SCREENSHOT_DIR } from './browser-screenshot-store'
import { AGENT_SCREENSHOT_MAX_BYTES, type ScreenshotArtifactDeps, type AgentNativeImage } from './screenshot-artifact'

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

function makeImage(width: number, height: number, jpeg: Buffer = Buffer.from('jpeg-bytes')): {
  image: AgentNativeImage
  resize: ReturnType<typeof vi.fn>
} {
  const resize = vi.fn(() => makeImage(width, height, jpeg).image)
  const image: AgentNativeImage = {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize,
    toJPEG: () => jpeg,
    toPNG: () => Buffer.from('png'),
  }
  return { image, resize }
}

function makeDeps(overrides: {
  width?: number
  height?: number
  bytes?: number
  jpeg?: Buffer
} = {}): ScreenshotArtifactDeps & { written: { path: string; data: Buffer }[]; resize: ReturnType<typeof vi.fn> } {
  const width = overrides.width ?? 1280
  const height = overrides.height ?? 800
  const bytes = overrides.bytes ?? 20 * 1024 * 1024
  const jpeg = overrides.jpeg ?? Buffer.from('browser-agent-jpeg')
  const { image, resize } = makeImage(width, height, jpeg)
  const written: { path: string; data: Buffer }[] = []
  return {
    createFromBuffer: () => image,
    createFromPath: () => image,
    statSize: () => bytes,
    writeAtomic: (path, data) => {
      written.push({ path, data })
    },
    written,
    resize,
  }
}

describe('persistScreenshot', () => {
  it('decodes the base64 to disk and returns a .png path', () => {
    const path = persistScreenshot(TINY_PNG, 'image/png')
    expect(path).toBeTruthy()
    expect(path!.endsWith('.png')).toBe(true)
    expect(path!.startsWith(BROWSER_SCREENSHOT_DIR)).toBe(true)
    expect(existsSync(path!)).toBe(true)
    expect(readFileSync(path!).equals(Buffer.from(TINY_PNG, 'base64'))).toBe(true)
  })

  it('uses a .jpg extension for jpeg images', () => {
    const path = persistScreenshot(TINY_PNG, 'image/jpeg')
    expect(path!.endsWith('.jpg')).toBe(true)
  })

  it('gives each screenshot a unique path', () => {
    const a = persistScreenshot(TINY_PNG, 'image/png')
    const b = persistScreenshot(TINY_PNG, 'image/png')
    expect(a).not.toBe(b)
  })
})

describe('persistScreenshotArtifact optimize', () => {
  it('JPEG-optimizes heavy browser screenshots without resize', () => {
    const deps = makeDeps({ width: 1280, height: 800, bytes: AGENT_SCREENSHOT_MAX_BYTES + 1 })
    const result = persistScreenshotArtifact(TINY_PNG, 'image/png', { width: 1280, height: 800 }, deps)
    expect(result).toBeTruthy()
    expect(result!.optimized).toBe(true)
    expect(result!.path.endsWith('.agent.jpg')).toBe(true)
    expect(result!.mimeType).toBe('image/jpeg')
    expect(result!.width).toBe(1280)
    expect(result!.height).toBe(800)
    expect(deps.written).toHaveLength(1)
    expect(deps.resize).not.toHaveBeenCalled()
  })
})
