/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentEvent } from '@superone/shared/agent-types'

const handleAgentEvent = vi.fn()
const syncLiveSnapshots = vi.fn<() => Promise<void>>()

vi.mock('@/stores/chat', () => ({
  _loadDefaultSessionPrefs: vi.fn().mockResolvedValue(undefined),
  useChatStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ handleAgentEvent }),
    {
      getState: () => ({ syncLiveSnapshots, handleAgentEvent, openToolIntercept: vi.fn(), clearToolIntercepts: vi.fn() }),
      setState: vi.fn(),
    },
  ),
}))

const onAgentEventSubscribers: Array<(event: AgentEvent) => void> = []
const onBashSubscribers: Array<(event: unknown) => void> = []

vi.stubGlobal('window', {
  agent: {
    onAgentEvent: (cb: (event: AgentEvent) => void) => {
      onAgentEventSubscribers.push(cb)
      return () => {
        const idx = onAgentEventSubscribers.indexOf(cb)
        if (idx >= 0) onAgentEventSubscribers.splice(idx, 1)
      }
    },
  },
  app: {
    onBashOutputEvent: (cb: (event: unknown) => void) => {
      onBashSubscribers.push(cb)
      return () => {}
    },
  },
})

const { useAgentEvents } = await import('./useAgentEvents')

describe('useAgentEvents', () => {
  it('buffers events arriving during snapshot hydration and flushes after completion', async () => {
    handleAgentEvent.mockReset()
    let resolveSync: () => void = () => {}
    syncLiveSnapshots.mockImplementation(() => new Promise<void>((r) => { resolveSync = r }))

    renderHook(() => useAgentEvents())
    await act(async () => { await Promise.resolve() })

    const subscriber = onAgentEventSubscribers[onAgentEventSubscribers.length - 1]
    expect(subscriber).toBeTruthy()

    subscriber({ type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'A' } } as AgentEvent)
    subscriber({ type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'B' } } as AgentEvent)

    expect(handleAgentEvent).not.toHaveBeenCalled()

    await act(async () => {
      resolveSync()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(handleAgentEvent).toHaveBeenCalledTimes(2)
    expect(handleAgentEvent.mock.calls[0][0].delta.text).toBe('A')
    expect(handleAgentEvent.mock.calls[1][0].delta.text).toBe('B')
  })

  it('forwards events directly after hydration completes', async () => {
    handleAgentEvent.mockReset()
    syncLiveSnapshots.mockResolvedValue(undefined)

    renderHook(() => useAgentEvents())
    await act(async () => { await Promise.resolve() })

    const subscriber = onAgentEventSubscribers[onAgentEventSubscribers.length - 1]
    subscriber({ type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'Z' } } as AgentEvent)

    expect(handleAgentEvent).toHaveBeenCalledTimes(1)
  })
})
