import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: new Map<unknown, unknown>(),
  workArea: { x: 100, y: 50, width: 1600, height: 1000 },
  mini: false,
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: unknown) => mocks.windows.get(sender) },
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) },
  screen: { getDisplayMatching: () => ({ workArea: mocks.workArea }) },
}))

import { registerWindowLayoutIpc } from './window-layout-ipc'

class NativeWindow extends EventEmitter {
  bounds = { x: 120, y: 80, width: 1200, height: 800 }
  minimum = [500, 400]
  fullscreen = false
  maximized = false
  destroyed = false
  autoEvents = true
  isDestroyed = () => this.destroyed
  isVisible = () => true
  getBounds = () => ({ ...this.bounds })
  getMinimumSize = () => this.minimum
  getSize = () => [this.bounds.width, this.bounds.height]
  getPosition = () => [this.bounds.x, this.bounds.y]
  isFullScreen = () => this.fullscreen
  isMaximized = () => this.maximized
  setMinimumSize = vi.fn((w: number, h: number) => { this.minimum = [w, h] })
  setBounds = vi.fn((bounds: typeof this.bounds) => { this.bounds = bounds; this.emit('resize') })
  unmaximize = vi.fn(() => { this.maximized = false; this.emit('unmaximize') })
  setFullScreen = vi.fn((value: boolean) => {
    if (!this.autoEvents) return
    this.fullscreen = value
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen')
  })
}

let win: NativeWindow
const sender = {}
function call(channel: keyof typeof AgentIpcChannels, ...args: unknown[]) {
  return mocks.handlers.get(AgentIpcChannels[channel])!({ sender }, ...args)
}

beforeEach(() => {
  win = new NativeWindow()
  mocks.windows.clear(); mocks.handlers.clear(); mocks.windows.set(sender, win); mocks.mini = false
  registerWindowLayoutIpc({ isMiniWindow: () => mocks.mini })
})

describe('native layout commands from a renderer', () => {
  it('reads and resizes the sender window, clamping to layout minimum and display work area', async () => {
    const other = new NativeWindow()
    mocks.windows.set({}, other)
    const result = await call('RESIZE_WINDOW', { width: 9999, height: 1 })
    expect(result).toMatchObject({ bounds: { width: 1600, height: 400 }, minSize: { width: 500, height: 400 }, fullscreen: false })
    expect(win.bounds.x + win.bounds.width).toBeLessThanOrEqual(1700)
    expect(other.setBounds).not.toHaveBeenCalled()
    expect(call('GET_WINDOW_LAYOUT_STATE')).toEqual(result)
  })

  it('allows one dimension and restores a maximized window before resizing', async () => {
    win.maximized = true
    const result = await call('RESIZE_WINDOW', { width: 900 })
    expect(win.unmaximize).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ bounds: { width: 900, height: 800 }, maximized: false })
  })

  it('resizes a manually filled macOS window even when unmaximize emits no event', async () => {
    vi.useFakeTimers()
    try {
      win.bounds = { ...mocks.workArea }
      win.isMaximized = () => win.bounds.width === mocks.workArea.width && win.bounds.height === mocks.workArea.height
      win.unmaximize.mockImplementation(() => {})
      const outcome = call('RESIZE_WINDOW', { width: 900, height: 800 }).then((value: unknown) => ({ value }), (error: unknown) => ({ error }))
      await vi.advanceTimersByTimeAsync(11_000)
      expect(await outcome).toMatchObject({ value: { bounds: { width: 900, height: 800 }, maximized: false } })
    } finally { vi.useRealTimers() }
  })

  it('rejects invalid dimensions, fullscreen resizing and impossible layout minima before effects', async () => {
    for (const size of [{}, { width: NaN }, { height: Infinity }, { width: 0 }, { width: 1.5 }, { width: '900' }]) {
      await expect(call('RESIZE_WINDOW', size)).rejects.toThrow()
    }
    win.fullscreen = true
    await expect(call('RESIZE_WINDOW', { width: 900 })).rejects.toThrow('exit_fullscreen')
    win.fullscreen = false; win.minimum = [2000, 400]
    await expect(call('RESIZE_WINDOW', { width: 900 })).rejects.toThrow('minimum')
    expect(win.setBounds).not.toHaveBeenCalled()
  })

  it('waits for native fullscreen events, exposes transitions, and makes repeated requests no-ops', async () => {
    win.autoEvents = false
    let complete = false
    const changing = call('SET_WINDOW_FULLSCREEN', true).then((result: unknown) => { complete = true; return result })
    expect(call('GET_WINDOW_LAYOUT_STATE').transitioning).toBe(true)
    expect(complete).toBe(false)
    await expect(call('RESIZE_WINDOW', { width: 900 })).rejects.toThrow('changing')
    win.fullscreen = true; win.emit('enter-full-screen')
    expect(await changing).toMatchObject({ fullscreen: true, transitioning: false })
    await call('SET_WINDOW_FULLSCREEN', true)
    expect(win.setFullScreen).toHaveBeenCalledOnce()
    win.autoEvents = true
    expect(await call('SET_WINDOW_FULLSCREEN', false)).toMatchObject({ fullscreen: false })
    expect(win.listenerCount('closed')).toBe(0)
  })

  it('rejects mini-window fullscreen and invalid booleans without changing the window', async () => {
    mocks.mini = true
    await expect(call('SET_WINDOW_FULLSCREEN', true)).rejects.toThrow('window_mode')
    await expect(call('SET_WINDOW_FULLSCREEN', 'true')).rejects.toThrow()
    expect(win.setFullScreen).not.toHaveBeenCalled()
  })

  it('rejects a disappearing sender and cleans pending fullscreen listeners on close', async () => {
    win.autoEvents = false
    const changing = call('SET_WINDOW_FULLSCREEN', true)
    const rejected = expect(changing).rejects.toThrow('closed')
    win.destroyed = true; win.emit('closed')
    await rejected
    expect(win.listenerCount('enter-full-screen')).toBe(0)
    expect(() => call('GET_WINDOW_LAYOUT_STATE')).toThrow('unavailable')
  })

  it('times out a missing native event and releases the transition lock', async () => {
    vi.useFakeTimers()
    try {
      win.autoEvents = false
      const changing = call('SET_WINDOW_FULLSCREEN', true)
      const rejected = expect(changing).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(11_000)
      await rejected
      expect(call('GET_WINDOW_LAYOUT_STATE').transitioning).toBe(false)
      expect(win.listenerCount('enter-full-screen')).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
