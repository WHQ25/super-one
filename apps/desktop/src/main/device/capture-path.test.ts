import { describe, expect, it } from 'vitest'
import { captureFileName } from './capture-path'

const SUFFIX = /-\d{3}-[0-9a-f]{4}\.(png|mp4)$/

describe('captureFileName', () => {
  it('slugs the device name and stamps a sortable local timestamp', () => {
    const name = captureFileName('iPhone 17 Pro Max', 'png', new Date(2026, 7, 20, 16, 44, 52, 317))
    expect(name.startsWith('iPhone-17-Pro-Max-20260820-164452-317-')).toBe(true)
    expect(name).toMatch(SUFFIX)
  })

  it('slugs an Android device name the same way', () => {
    expect(captureFileName('Medium Phone API 36.1', 'png', new Date(2026, 7, 22, 9, 15, 0)))
      .toMatch(/^Medium-Phone-API-36-1-20260822-091500-000-[0-9a-f]{4}\.png$/)
  })

  it('falls back to a platform-neutral name when there is nothing to slug', () => {
    // Was "simulator" while only one platform captured anything. A PNG off an emulator
    // called `simulator-…` would be a small lie in a filename the user has to read.
    expect(captureFileName('···', 'mp4', new Date(2026, 0, 2, 3, 4, 5)))
      .toMatch(/^device-20260102-030405-000-[0-9a-f]{4}\.mp4$/)
  })

  it('never hands two captures inside one second the same name', () => {
    const at = new Date(2026, 7, 20, 16, 44, 52, 100)
    const names = new Set(Array.from({ length: 50 }, () => captureFileName('Pixel', 'png', at)))
    expect(names.size).toBe(50)
  })
})
