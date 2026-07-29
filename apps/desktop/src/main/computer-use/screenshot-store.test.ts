import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import {
  persistComputerUseScreenshot,
  needsComputerUseOptimize,
  writeOptimizedAgentImage,
  COMPUTER_USE_SCREENSHOT_DIR,
  CU_AGENT_MAX_BYTES,
  type ScreenshotStoreDeps,
} from './screenshot-store'
import type { AgentNativeImage } from '../agent/screenshot-artifact'

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
} = {}): ScreenshotStoreDeps & { written: { path: string; data: Buffer }[]; resize: ReturnType<typeof vi.fn> } {
  const width = overrides.width ?? 1440
  const height = overrides.height ?? 900
  const bytes = overrides.bytes ?? 20 * 1024 * 1024
  const jpeg = overrides.jpeg ?? Buffer.from('agent-jpeg')
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

describe('needsComputerUseOptimize', () => {
  it('is false under the byte budget', () => {
    expect(needsComputerUseOptimize(8000, 6000, 100_000)).toBe(false)
  })

  it('is true when the file is heavier than the byte budget', () => {
    expect(needsComputerUseOptimize(800, 600, CU_AGENT_MAX_BYTES + 1)).toBe(true)
  })
})

describe('persistComputerUseScreenshot', () => {
  it('writes under the fixed computer-use screenshot directory', () => {
    const result = persistComputerUseScreenshot(TINY_PNG, 'image/png')
    expect(result).toBeTruthy()
    expect(result!.path.startsWith(COMPUTER_USE_SCREENSHOT_DIR)).toBe(true)
    expect(existsSync(result!.path)).toBe(true)
    expect(readFileSync(result!.path).equals(Buffer.from(TINY_PNG, 'base64'))).toBe(true)
  })

  it('JPEG-optimizes heavy files without changing dimensions', () => {
    const deps = makeDeps({ width: 1440, height: 900, bytes: 10 * 1024 * 1024 })
    const result = persistComputerUseScreenshot(
      TINY_PNG,
      'image/png',
      { width: 1440, height: 900 },
      { deps },
    )
    expect(result).toBeTruthy()
    expect(result!.optimized).toBe(true)
    expect(result!.path.endsWith('.agent.jpg')).toBe(true)
    expect(result!.mimeType).toBe('image/jpeg')
    expect(result!.width).toBe(1440)
    expect(result!.height).toBe(900)
    expect(deps.written).toHaveLength(1)
    expect(deps.resize).not.toHaveBeenCalled()
  })

  it('returns unique paths for successive captures', () => {
    const a = persistComputerUseScreenshot(TINY_PNG, 'image/png')
    const b = persistComputerUseScreenshot(TINY_PNG, 'image/png')
    expect(a!.path).not.toBe(b!.path)
  })
})

describe('writeOptimizedAgentImage', () => {
  it('re-encodes without resize when the byte budget is exceeded', () => {
    const deps = makeDeps({ width: 800, height: 600, bytes: CU_AGENT_MAX_BYTES + 1 })
    const out = writeOptimizedAgentImage('/tmp/heavy.png', 800, 600, deps)
    expect(out?.path).toBe('/tmp/heavy.agent.jpg')
    expect(out?.width).toBe(800)
    expect(out?.height).toBe(600)
    expect(deps.resize).not.toHaveBeenCalled()
    expect(deps.written).toHaveLength(1)
  })
})
