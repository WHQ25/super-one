import { describe, expect, it, vi } from 'vitest'
import { revealPrimaryWindow, takeSingleInstanceLock, watchSecondInstance, type RevealableWindow } from './single-instance'

function window(overrides: Partial<RevealableWindow> = {}): RevealableWindow {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  }
}

describe('one process per userData profile', () => {
  it('keeps the process that acquires the profile lock', () => {
    expect(takeSingleInstanceLock({ requestSingleInstanceLock: () => true })).toBe(true)
  })

  it('tells a second launch of the same profile to exit', () => {
    expect(takeSingleInstanceLock({ requestSingleInstanceLock: () => false })).toBe(false)
  })

  it('reveals the existing main window when another launch is refused', () => {
    const reveal = vi.fn()
    const host = {
      on: vi.fn((event: string, listener: () => void) => {
        expect(event).toBe('second-instance')
        listener()
      }),
    }
    watchSecondInstance(host, reveal)
    expect(reveal).toHaveBeenCalledOnce()
  })

  it('restores a minimized main window and gives it focus', () => {
    const win = window({ isMinimized: () => true })
    const host = { focus: vi.fn() }
    revealPrimaryWindow(host, win)
    expect(win.restore).toHaveBeenCalledOnce()
    expect(host.focus).toHaveBeenCalledWith({ steal: true })
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('leaves a closed main window for the caller to recreate', () => {
    const win = window({ isDestroyed: () => true })
    const host = { focus: vi.fn() }
    revealPrimaryWindow(host, win)
    expect(host.focus).not.toHaveBeenCalled()
    expect(win.show).not.toHaveBeenCalled()
  })
})
