/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useChatStore } from '@/stores/chat'
import {
  selectViewfinderTarget,
  useAgentViewfinderStore,
} from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useComputerViewfinderStore } from '@/stores/computer-viewfinder'
import { useAgentViewfinder } from './useAgentViewfinder'

let agentEventListener: ((event: never) => void) | null = null
let computerClaimListener: ((claim: never) => void) | null = null
let deviceClaimListener: ((claim: never) => void) | null = null
let computerFrameListener: ((frame: never) => void) | null = null

beforeEach(() => {
  agentEventListener = null
  computerClaimListener = null
  deviceClaimListener = null
  Object.assign(window.agent, {
    onAgentEvent: vi.fn((listener: (event: never) => void) => {
      agentEventListener = listener
      return () => { agentEventListener = null }
    }),
  })
  Object.assign(window.app, {
    onComputerUseViewfinderClaim: vi.fn((listener: (claim: never) => void) => {
      computerClaimListener = listener
      return () => { computerClaimListener = null }
    }),
    onComputerUseViewfinderFrame: vi.fn((listener: (frame: never) => void) => {
      computerFrameListener = listener
      return () => { computerFrameListener = null }
    }),
    getComputerUseViewfinderTarget: vi.fn(async () => null),
    hideComputerUseViewfinder: vi.fn(async () => true),
  })
  Object.assign(window.environment, {
    onDeviceViewfinderClaim: vi.fn((listener: (claim: never) => void) => {
      deviceClaimListener = listener
      return () => { deviceClaimListener = null }
    }),
  })
  useChatStore.setState({
    activeProject: '/project',
    projectSessions: { '/project': { _activeSessionId: 'session-a' } },
  } as unknown as Parameters<typeof useChatStore.setState>[0])
  useMosaicStore.setState({ mode: 'single' })
  useComputerViewfinderStore.getState().reset()
  useAgentViewfinderStore.setState({ activeBySession: {} })
  useBrowserStore.setState({
    tabs: {},
    automationPreviewBrowserId: null,
    pendingPreviewBrowserId: null,
    automationPreviewReady: {},
  })
})

describe('agent viewfinder activity bridge', () => {
  it('accepts frames after restoring a computer claim emitted before subscription', async () => {
    Object.assign(window.app, {
      getComputerUseViewfinderTarget: vi.fn(async () => ({ active: true, sessionId: 'session-a', windowId: 42 })),
    })
    renderHook(() => useAgentViewfinder())

    await waitFor(() => expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'computer', targetId: '42' }))
    act(() => computerFrameListener?.({ sessionId: 'session-a', windowId: 42, width: 480, height: 320, data: 'jpeg' } as never))
    expect(useComputerViewfinderStore.getState().frames['session-a']?.data).toBe('jpeg')
  })

  it.each(['release', 'turn-end', 'device'] as const)('ignores a delayed computer snapshot after %s', async (change) => {
    let resolve!: (claim: unknown) => void
    Object.assign(window.app, {
      getComputerUseViewfinderTarget: vi.fn(() => new Promise((done) => { resolve = done })),
    })
    renderHook(() => useAgentViewfinder())
    act(() => {
      if (change === 'release') computerClaimListener?.({ active: false, sessionId: 'session-a' } as never)
      if (change === 'turn-end') agentEventListener?.({ type: 'status_change', status: 'idle', sessionId: 'session-a' } as never)
      if (change === 'device') deviceClaimListener?.({ sessionId: 'session-a', deviceId: 'ios:device-a' } as never)
    })
    await act(async () => { resolve({ active: true, sessionId: 'session-a', windowId: 42 }) })

    expect(useComputerViewfinderStore.getState().targets['session-a']).toBeUndefined()
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a')?.kind).not.toBe('computer')
  })

  it('does not read a stale native target when another surface finishes its turn', async () => {
    useAgentViewfinderStore.getState().activate('session-a', 'browser', 'browser-a')
    const read = vi.fn(async () => ({ active: true, sessionId: 'session-a', windowId: 42 }))
    Object.assign(window.app, { getComputerUseViewfinderTarget: read })
    renderHook(() => useAgentViewfinder())

    await act(async () => agentEventListener?.({ type: 'status_change', status: 'idle', sessionId: 'session-a' } as never))

    expect(read).not.toHaveBeenCalled()
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a')).toBeNull()
  })

  it('uses the execution-layer device claim when the harness tool event is absent', () => {
    renderHook(() => useAgentViewfinder())

    act(() => deviceClaimListener?.({
      sessionId: 'session-a',
      deviceId: 'android:emulator-5554',
    } as never))

    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'device', targetId: 'android:emulator-5554' })
    expect(window.app.hideComputerUseViewfinder).toHaveBeenCalledWith('session-a')
  })

  it('reactivates a still-present device when the agent operates it again', () => {
    renderHook(() => useAgentViewfinder())

    act(() => agentEventListener?.({
      type: 'content_delta',
      sessionId: 'session-a',
      messageId: 'message-a',
      delta: {
        type: 'tool_use',
        toolName: 'mcp__superone__device_act',
        toolUseId: 'tool-a',
        input: '{}',
      },
    } as never))

    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'device', targetId: null })
  })

  it('retains operations from a session that is not on screen', () => {
    renderHook(() => useAgentViewfinder())

    act(() => agentEventListener?.({
      type: 'content_delta',
      sessionId: 'session-b',
      messageId: 'message-b',
      delta: {
        type: 'tool_use',
        toolName: 'mcp__superone__device_act',
        toolUseId: 'tool-b',
        input: '{"device":"ios-sim:device-b"}',
      },
    } as never))

    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-b'))
      .toEqual({ kind: 'device', targetId: 'ios-sim:device-b' })
  })

  it('clears only the completed session and its ready browser previews', () => {
    renderHook(() => useAgentViewfinder())
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://a.example', 'session-a')
      useBrowserStore.getState().ensure('browser-b', 'https://b.example', 'session-b')
      useBrowserStore.getState().patch('browser-a', { loading: false })
      useBrowserStore.getState().patch('browser-b', { loading: false })
      useBrowserStore.getState().beginAutomation('browser-a')
      useBrowserStore.getState().beginAutomation('browser-b')
      useBrowserStore.getState().markAutomationPreviewReady('browser-a')
      useBrowserStore.getState().markAutomationPreviewReady('browser-b')
      useAgentViewfinderStore.getState().activate('session-a', 'browser', 'browser-a')
      useAgentViewfinderStore.getState().activate('session-b', 'browser', 'browser-b')
      agentEventListener?.({
        type: 'status_change',
        sessionId: 'session-a',
        status: 'idle',
      } as never)
    })

    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a')).toBeNull()
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-b'))
      .toEqual({ kind: 'browser', targetId: 'browser-b' })
    expect(useBrowserStore.getState().automationPreviewReady).toEqual({ 'browser-b': true })
    expect(window.app.hideComputerUseViewfinder).toHaveBeenCalledWith('session-a')
  })

  it('keeps a dismissed computer target hidden until the target changes', () => {
    renderHook(() => useAgentViewfinder())
    const hide = vi.mocked(window.app.hideComputerUseViewfinder)

    act(() => computerClaimListener?.({
      active: true,
      sessionId: 'session-a',
      windowId: 11,
    } as never))
    act(() => useComputerViewfinderStore.getState().hide('session-a'))
    act(() => computerClaimListener?.({
      active: true,
      sessionId: 'session-a',
      windowId: 11,
    } as never))

    expect(hide).toHaveBeenCalledWith('session-a')
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'computer', targetId: '11' })

    act(() => computerClaimListener?.({
      active: true,
      sessionId: 'session-a',
      windowId: 12,
    } as never))
    expect(useComputerViewfinderStore.getState().hiddenSessions['session-a']).toBe(false)
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'computer', targetId: '12' })
  })
})
