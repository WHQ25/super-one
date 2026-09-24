import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))

import type { BrowserWindow } from 'electron'
import { holdHostPainting, withHostPainting } from './host-paint-lease'

function fakeWindow({ focused = false } = {}) {
  const throttling: boolean[] = []
  const webContents = {
    setBackgroundThrottling: vi.fn((allowed: boolean) => { throttling.push(allowed) }),
    capturePage: vi.fn(async () => ({})),
  }
  const win = {
    webContents,
    isDestroyed: () => false,
    isFocused: () => focused,
  } as unknown as BrowserWindow
  return { win, webContents, throttling }
}

describe('withHostPainting', () => {
  it('keeps the window compositing for the call and hides a covered window again after it', async () => {
    const { win, webContents, throttling } = fakeWindow()

    const result = await withHostPainting(win, async () => {
      expect(throttling).toEqual([false])
      return 'shot'
    })

    expect(result).toBe('shot')
    expect(throttling).toEqual([false, true])
    expect(webContents.capturePage).toHaveBeenCalledTimes(1)
  })

  it('holds the lease until the last overlapping call finishes', async () => {
    const { win, throttling } = fakeWindow()
    let finishFirst!: () => void
    const first = withHostPainting(win, () => new Promise<void>((resolve) => { finishFirst = resolve }))

    await withHostPainting(win, async () => {})
    expect(throttling).toEqual([false])

    finishFirst()
    await first
    expect(throttling).toEqual([false, true])
  })

  it('releases the lease when the call fails', async () => {
    const { win, throttling } = fakeWindow()

    await expect(withHostPainting(win, async () => { throw new Error('capture failed') })).rejects.toThrow('capture failed')

    expect(throttling).toEqual([false, true])
  })

  it('counts a held lease once however often it is released', () => {
    const { win, throttling } = fakeWindow()
    const first = holdHostPainting(win)
    const second = holdHostPainting(win)

    first()
    first()
    expect(throttling).toEqual([false])

    second()
    expect(throttling).toEqual([false, true])
  })

  it('skips the visibility refresh for a focused window, which Chromium never hid', async () => {
    const { win, webContents, throttling } = fakeWindow({ focused: true })

    await withHostPainting(win, async () => {})

    expect(throttling).toEqual([false, true])
    expect(webContents.capturePage).not.toHaveBeenCalled()
  })
})
