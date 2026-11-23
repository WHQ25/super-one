import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const registeredHandlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      registeredHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      registeredHandlers.delete(channel)
    }),
  },
}))

const { MainPluginHost } = await import('../kernel/main-plugin-host')
const { createReviewMainPlugin, ReviewServiceToken } = await import('./review-plugin')

describe('Review Main built-in plugin', () => {
  beforeEach(() => {
    registeredHandlers.clear()
  })

  it('registers Review IPCs and ReviewServiceToken and tears all down on single dispose()', () => {
    const mainHost = new MainPluginHost()
    const unsub = vi.fn()
    const fakeSessionManager = { onAny: vi.fn(() => unsub) } as never

    const mounted = mainHost.mount(createReviewMainPlugin({ sessionManager: fakeSessionManager }))

    expect(registeredHandlers.has(AgentIpcChannels.REVIEW_GET_SESSION)).toBe(true)
    expect(registeredHandlers.has(AgentIpcChannels.REVIEW_GET_WORKSPACE)).toBe(true)
    expect(registeredHandlers.has(AgentIpcChannels.REVIEW_GET_FILE_CONTENTS)).toBe(true)
    expect(mainHost.services.get(ReviewServiceToken)).toBeDefined()

    mounted.dispose()

    expect(registeredHandlers.has(AgentIpcChannels.REVIEW_GET_SESSION)).toBe(false)
    expect(registeredHandlers.has(AgentIpcChannels.REVIEW_GET_WORKSPACE)).toBe(false)
    expect(registeredHandlers.has(AgentIpcChannels.REVIEW_GET_FILE_CONTENTS)).toBe(false)
    expect(mainHost.services.get(ReviewServiceToken)).toBeUndefined()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
