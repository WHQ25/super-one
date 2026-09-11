import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => void>() }))
vi.mock('electron', () => ({ ipcMain: { on: (channel: string, callback: (...args: unknown[]) => void) => handlers.set(channel, callback) } }))
import { installDraftOpenFlush } from './draft-open-flush'

afterEach(() => { handlers.clear(); vi.useRealTimers() })
const windowFor = (id: number) => ({ isDestroyed: () => false, webContents: { id, isDestroyed: () => false, send: vi.fn() } })

describe('draft handover waits for desktop persistence', () => {
  it('waits for every app window and ignores an unrelated renderer acknowledgement', async () => {
    const one = windowFor(1), two = windowFor(2)
    const prepare = installDraftOpenFlush(new Set([one, two]) as unknown as Set<BrowserWindow>)
    let done = false
    const task = prepare('draft').then(() => { done = true })
    const requestId = one.webContents.send.mock.calls[0][1]
    expect(one.webContents.send.mock.calls[0]).toEqual([AgentIpcChannels.ENVIRONMENT_PREPARE_DRAFT_OPEN, requestId, 'draft'])
    const acknowledge = handlers.get(AgentIpcChannels.ENVIRONMENT_DRAFT_OPEN_READY)!
    acknowledge({ sender: { id: 99 } }, requestId)
    acknowledge({ sender: { id: 1 } }, requestId)
    await Promise.resolve()
    expect(done).toBe(false)
    acknowledge({ sender: { id: 2 } }, requestId)
    await task
    expect(done).toBe(true)
  })
  it('refuses handover when a renderer cannot persist the draft', async () => {
    vi.useFakeTimers()
    const one = windowFor(1)
    const prepare = installDraftOpenFlush(new Set([one]) as unknown as Set<BrowserWindow>)
    const result = expect(prepare('draft')).rejects.toThrow(/Could not save/)
    await vi.advanceTimersByTimeAsync(3000)
    await result
  })
})
