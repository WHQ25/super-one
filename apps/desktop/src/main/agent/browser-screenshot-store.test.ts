import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync } from 'fs'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { persistScreenshot } from './browser-screenshot-store'

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

describe('persistScreenshot', () => {
  it('decodes the base64 to disk and returns a .png path', () => {
    const path = persistScreenshot(TINY_PNG, 'image/png')
    expect(path).toBeTruthy()
    expect(path!.endsWith('.png')).toBe(true)
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
