import { describe, expect, it } from 'vitest'
import { captureFileName } from './capture-path'

describe('captureFileName', () => {
  it('slugs the device name and stamps a sortable local timestamp', () => {
    expect(captureFileName('iPhone 17 Pro Max', 'png', new Date(2026, 7, 20, 16, 44, 52)))
      .toBe('iPhone-17-Pro-Max-20260820-164452.png')
  })

  it('slugs an Android device name the same way', () => {
    expect(captureFileName('Medium Phone API 36.1', 'png', new Date(2026, 7, 22, 9, 15, 0)))
      .toBe('Medium-Phone-API-36-1-20260822-091500.png')
  })

  it('falls back to a platform-neutral name when there is nothing to slug', () => {
    // Was "simulator" while only one platform captured anything. A PNG off an emulator
    // called `simulator-…` would be a small lie in a filename the user has to read.
    expect(captureFileName('···', 'mp4', new Date(2026, 0, 2, 3, 4, 5)))
      .toBe('device-20260102-030405.mp4')
  })
})
