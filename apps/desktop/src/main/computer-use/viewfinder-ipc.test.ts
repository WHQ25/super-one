import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), call: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => ipc.handlers.set(channel, handler) },
}))
vi.mock('../logger', () => ({ default: { warn: vi.fn() } }))
vi.mock('./platform/macos-helper-client', () => ({ getSharedHelperClient: () => ({ call: ipc.call }) }))

import { registerComputerUseViewfinderIpc } from './viewfinder-ipc'
import { claimComputerUseViewfinder, releaseComputerUseViewfinder } from './viewfinder'

beforeEach(() => {
  releaseComputerUseViewfinder()
  ipc.handlers.clear()
  ipc.call.mockReset().mockResolvedValue({ shown: true, resized: true })
  registerComputerUseViewfinderIpc()
})

describe('Computer Use late subscriber recovery', () => {
  it('reads the current session target without starting native capture and loses it on release', async () => {
    claimComputerUseViewfinder({ sessionId: 'session-a', windowId: 42, pid: 123 })
    const read = ipc.handlers.get(AgentIpcChannels.COMPUTER_USE_VIEWFINDER_CLAIM)!

    expect(await read({}, 'session-a')).toMatchObject({ active: true, windowId: 42 })
    expect(await read({}, 'session-b')).toBeNull()
    expect(await read({}, '')).toBeNull()
    expect(ipc.call).not.toHaveBeenCalled()

    releaseComputerUseViewfinder('session-a')
    expect(await read({}, 'session-a')).toBeNull()
  })

  it.runIf(process.platform === 'darwin')('keeps focus and capture resizing scoped to the active native target', async () => {
    claimComputerUseViewfinder({ sessionId: 'session-a', windowId: 42, pid: 123 })
    const focus = ipc.handlers.get(AgentIpcChannels.COMPUTER_USE_VIEWFINDER_FOCUS)!
    const resize = ipc.handlers.get(AgentIpcChannels.COMPUTER_USE_VIEWFINDER_RESIZE)!
    expect(await focus({}, 'session-b')).toBe(false)
    expect(await resize({}, 'session-a', 99, 480, 320)).toBe(false)
    expect(ipc.call).not.toHaveBeenCalled()

    expect(await focus({}, 'session-a')).toBe(true)
    expect(ipc.call).toHaveBeenCalledWith('focus_window', { pid: 123, windowId: 42 })
    expect(await resize({}, 'session-a', 42, 480, 320)).toBe(true)
    expect(ipc.call).toHaveBeenCalledWith('pip_resize', { sessionId: 'session-a', windowId: 42, width: 480, height: 320 })
  })
})
