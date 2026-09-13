import { afterAll, describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'superone-browser-shots-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
afterAll(() => rmSync(userData, { recursive: true, force: true }))

import { persistScreenshot, persistScreenshotArtifact } from './browser-screenshot-store'
import { AGENT_SCREENSHOT_MAX_BYTES, type ScreenshotArtifactDeps, type AgentNativeImage } from './screenshot-artifact'
import { producerDir } from '../media-output-paths'
import { collectArtifacts, takeArtifacts } from '../mcp/artifact-registry'

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
  it('decodes the base64 into the session browser zone and returns a .png path', () => {
    const path = persistScreenshot('session-a', TINY_PNG, 'image/png')
    expect(path).toBeTruthy()
    expect(path!.endsWith('.png')).toBe(true)
    expect(path!.startsWith(producerDir('session-a', 'browser'))).toBe(true)
    expect(existsSync(path!)).toBe(true)
    expect(readFileSync(path!).equals(Buffer.from(TINY_PNG, 'base64'))).toBe(true)
  })

  it('files a capture with no session under the adhoc zone', () => {
    const path = persistScreenshot(undefined, TINY_PNG, 'image/png')
    expect(path!.startsWith(producerDir(undefined, 'browser'))).toBe(true)
    expect(path).toContain('/sync/adhoc/browser/')
  })

  it('uses a .jpg extension for jpeg images', () => {
    const path = persistScreenshot('session-a', TINY_PNG, 'image/jpeg')
    expect(path!.endsWith('.jpg')).toBe(true)
  })

  it('gives each screenshot a unique path', () => {
    const a = persistScreenshot('session-a', TINY_PNG, 'image/png')
    const b = persistScreenshot('session-a', TINY_PNG, 'image/png')
    expect(a).not.toBe(b)
  })

  it('registers the file for the tool call that took it', async () => {
    let path: string | null = null
    await collectArtifacts('session-a', 'call-1', async () => {
      path = persistScreenshot('session-a', TINY_PNG, 'image/png')
    })
    expect(takeArtifacts('session-a', 'call-1')).toEqual([{ path, producer: 'browser', final: true }])
  })
})

describe('persistScreenshotArtifact optimize', () => {
  it('JPEG-optimizes heavy browser screenshots without resize and registers the sibling as its own ref', async () => {
    const deps = makeDeps({ width: 1280, height: 800, bytes: AGENT_SCREENSHOT_MAX_BYTES + 1 })
    let result: ReturnType<typeof persistScreenshotArtifact> = null
    await collectArtifacts('session-a', 'call-1', async () => {
      result = persistScreenshotArtifact('session-a', TINY_PNG, 'image/png', { width: 1280, height: 800 }, deps)
    })
    expect(result).toBeTruthy()
    expect(result!.optimized).toBe(true)
    expect(result!.path.endsWith('.agent.jpg')).toBe(true)
    expect(result!.mimeType).toBe('image/jpeg')
    expect(result!.width).toBe(1280)
    expect(result!.height).toBe(800)
    expect(deps.written).toHaveLength(1)
    expect(deps.resize).not.toHaveBeenCalled()
    const refs = takeArtifacts('session-a', 'call-1')
    expect(refs.map((r) => r.path)).toEqual([result!.path.replace(/\.agent\.jpg$/, '.png'), result!.path])
    expect(refs.every((r) => r.producer === 'browser' && r.final)).toBe(true)
  })
})
