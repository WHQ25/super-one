import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { attachIosSimulatorGestureEvents } from './gesture-events'

function fakeWindow() {
  let rotateHandler: ((_event: unknown, rotation: number) => void) | undefined
  let destroyed = false
  const send = vi.fn()
  const win = {
    id: 42,
    isDestroyed: () => destroyed,
    webContents: { send },
    on: vi.fn((event: string, handler: (_event: unknown, rotation: number) => void) => {
      if (event === 'rotate-gesture') rotateHandler = handler
      return win
    }),
  }
  return {
    win: win as unknown as BrowserWindow,
    send,
    rotate: (rotation: number) => rotateHandler?.({}, rotation),
    destroy: () => { destroyed = true },
  }
}

describe('attachIosSimulatorGestureEvents', () => {
  it('forwards finite macOS rotation deltas to the owning renderer', () => {
    const target = fakeWindow()
    attachIosSimulatorGestureEvents(target.win, 'darwin')

    target.rotate(-1.25)
    target.rotate(0)

    expect(target.send).toHaveBeenNthCalledWith(
      1,
      AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_ROTATE_GESTURE,
      -1.25,
    )
    expect(target.send).toHaveBeenNthCalledWith(
      2,
      AgentIpcChannels.ENVIRONMENT_IOS_SIMULATOR_ROTATE_GESTURE,
      0,
    )
  })

  it('does not forward after the window is destroyed', () => {
    const target = fakeWindow()
    attachIosSimulatorGestureEvents(target.win, 'darwin')
    target.destroy()

    target.rotate(10)

    expect(target.send).not.toHaveBeenCalled()
  })

  it('does not register native gesture handling on other platforms', () => {
    const target = fakeWindow()
    attachIosSimulatorGestureEvents(target.win, 'win32')

    expect(target.win.on).not.toHaveBeenCalled()
  })
})
