/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { selectViewfinderTarget, useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useComputerViewfinderStore } from '@/stores/computer-viewfinder'
import { useDeviceInstanceStore } from '@/stores/device-instances'
import { useDevicePipStore } from '@/stores/device-pip'
import { StatusBarPip, useHiddenPipTarget } from './StatusBarPip'

const restoreComputerUseViewfinder = vi.fn()

function Indicator() {
  const target = useHiddenPipTarget('session-a')
  return target ? <StatusBarPip target={target} /> : null
}

beforeEach(() => {
  restoreComputerUseViewfinder.mockReset()
  restoreComputerUseViewfinder.mockResolvedValue(true)
  Object.assign(window.app, { restoreComputerUseViewfinder })
  useAgentViewfinderStore.setState({ activeBySession: {} })
  useComputerViewfinderStore.getState().reset()
  useBrowserStore.setState({
    tabs: {},
    automationPreviewReady: {},
    automationPreviewBrowserId: null,
    expandedBrowserId: null,
    pinnedPipBrowserId: null,
    hiddenPreviewBrowserId: null,
  })
  useDevicePipStore.setState({
    readyInstanceId: null,
    readyDevices: {},
    expandedInstanceId: null,
    hiddenInstanceId: null,
    device: null,
  })
  useDeviceInstanceStore.setState({ byId: {} })
})

describe('hidden PiP status indicator', () => {
  it('restores Computer Use native capture', async () => {
    act(() => {
      useComputerViewfinderStore.getState().applyClaim({
        sessionId: 'session-a', active: true, windowId: 42,
      })
      useComputerViewfinderStore.getState().hide('session-a')
      useAgentViewfinderStore.getState().activate('session-a', 'computer', '42')
    })
    render(<Indicator />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(restoreComputerUseViewfinder).toHaveBeenCalledWith('session-a'))
    expect(useComputerViewfinderStore.getState().hiddenSessions['session-a']).toBeUndefined()
  })

  it('restores a hidden browser preview', async () => {
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com', 'session-a')
      useBrowserStore.setState({ automationPreviewReady: { 'browser-a': true } })
      useBrowserStore.getState().hidePreview('browser-a')
      useAgentViewfinderStore.getState().activate('session-a', 'browser', 'browser-a')
    })
    render(<Indicator />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(useBrowserStore.getState().hiddenPreviewBrowserId).toBeNull())
    expect(useBrowserStore.getState().pinnedPipBrowserId).toBe('browser-a')
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'browser', targetId: 'browser-a' })
  })

  it('restores a hidden device preview', async () => {
    act(() => {
      useDeviceInstanceStore.setState({
        byId: {
          'instance-a': { instanceId: 'instance-a', sessionId: 'session-a', deviceId: 'device-a' },
        },
      })
      useDevicePipStore.getState().setReady('instance-a', {
        id: 'device-a', provider: 'ios-sim', platform: 'ios', width: 1200, height: 2600,
      })
      useDevicePipStore.getState().hidePreview('instance-a')
      useAgentViewfinderStore.getState().activate('session-a', 'device', 'device-a')
    })
    render(<Indicator />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(useDevicePipStore.getState().hiddenInstanceId).toBeNull())
    expect(useDevicePipStore.getState().readyInstanceId).toBe('instance-a')
    expect(selectViewfinderTarget(useAgentViewfinderStore.getState(), 'session-a'))
      .toEqual({ kind: 'device', targetId: 'device-a' })
  })
})
