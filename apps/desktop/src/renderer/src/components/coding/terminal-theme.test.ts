/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onTerminalThemeChange } from './terminal-theme'

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

afterEach(() => {
  document.documentElement.className = ''
  delete document.documentElement.dataset.terminalFontSize
})

describe('onTerminalThemeChange', () => {
  it('applies the CURRENT appearance on subscribe, not only on later changes', () => {
    // The regression: xterm instances outlive their panel, so a light/dark flip
    // that happens while the panel is unmounted (switching to Settings unmounts
    // the whole coding workspace) is missed entirely. Subscribing has to be a
    // catch-up point, or the terminal keeps rendering the previous scheme.
    const cb = vi.fn()
    const off = onTerminalThemeChange(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it('re-applies when the dark class flips on <html>', async () => {
    const cb = vi.fn()
    const off = onTerminalThemeChange(cb)
    cb.mockClear()

    document.documentElement.classList.add('dark')
    await nextFrame()
    await nextFrame()

    expect(cb).toHaveBeenCalled()
    off()
  })

  it('re-applies when a terminal appearance data attribute changes', async () => {
    const cb = vi.fn()
    const off = onTerminalThemeChange(cb)
    cb.mockClear()

    document.documentElement.dataset.terminalFontSize = '18'
    await nextFrame()
    await nextFrame()

    expect(cb).toHaveBeenCalled()
    off()
  })

  it('stops firing after unsubscribe', async () => {
    const cb = vi.fn()
    const off = onTerminalThemeChange(cb)
    off()
    cb.mockClear()

    document.documentElement.classList.add('dark')
    await nextFrame()
    await nextFrame()

    expect(cb).not.toHaveBeenCalled()
  })
})
