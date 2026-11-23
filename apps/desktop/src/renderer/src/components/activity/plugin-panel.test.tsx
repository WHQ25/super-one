/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createSlotRegistry } from '@superone/ui-slots'
import { SlotRegistryProvider } from '@superone/ui-slots/react'
import { PluginDockPanel } from './PluginDockPanel'
import { closeGhostPluginPanels, pluginPanelId, setDockApi } from './activity-panel-api'
import '@/lib/ui-slots'

afterEach(() => {
  cleanup()
  setDockApi(null)
})

function makePanelProps(panelKey: string, title = 'Plugin Panel') {
  return {
    params: { panelKey },
    api: { title } as never,
    containerApi: {} as never,
  }
}

describe('PluginDockPanel', () => {
  it('renders safe fallback when rendered without a SlotRegistryProvider', () => {
    render(<PluginDockPanel {...makePanelProps('sample:inspector')} />)
    expect(screen.getByText('Plugin panel unavailable')).toBeTruthy()
  })

  it('renders safe fallback when panelKey is unregistered or disabled', () => {
    const registry = createSlotRegistry()
    render(
      <SlotRegistryProvider registry={registry}>
        <PluginDockPanel {...makePanelProps('missing:panel')} />
      </SlotRegistryProvider>,
    )
    expect(screen.getByText('Plugin panel unavailable')).toBeTruthy()
  })

  it('renders registered activity.panel component and isolates throws with ErrorBoundary', () => {
    const registry = createSlotRegistry()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registry.registerKeyed('activity.panel', 'healthy:panel', {
      component: ({ panelKey, title }) => <div>{`${title}:${panelKey}`}</div>,
    })
    registry.registerKeyed('activity.panel', 'broken:panel', {
      component: () => {
        throw new Error('panel boom')
      },
    })

    const { rerender } = render(
      <SlotRegistryProvider registry={registry}>
        <PluginDockPanel {...makePanelProps('healthy:panel', 'Healthy')} />
      </SlotRegistryProvider>,
    )
    expect(screen.getByText('Healthy:healthy:panel')).toBeTruthy()

    rerender(
      <SlotRegistryProvider registry={registry}>
        <PluginDockPanel {...makePanelProps('broken:panel', 'Broken')} />
      </SlotRegistryProvider>,
    )
    expect(screen.getByText('Plugin panel unavailable')).toBeTruthy()
    errorSpy.mockRestore()
  })
})

describe('closeGhostPluginPanels', () => {
  it('closes plugin panels whose panelKey is no longer alive and preserves live or non-plugin panels', () => {
    const closeDead = vi.fn()
    const closeLive = vi.fn()
    const closeOther = vi.fn()
    setDockApi({
      panels: [
        { id: pluginPanelId('dead:panel'), params: { panelKey: 'dead:panel' }, api: { close: closeDead } },
        { id: pluginPanelId('live:panel'), params: { panelKey: 'live:panel' }, api: { close: closeLive } },
        { id: 'file:src/index.ts', params: { filePath: 'src/index.ts' }, api: { close: closeOther } },
      ],
      activePanel: undefined,
    } as never)

    closeGhostPluginPanels((panelKey) => panelKey === 'live:panel')

    expect(closeDead).toHaveBeenCalledOnce()
    expect(closeLive).not.toHaveBeenCalled()
    expect(closeOther).not.toHaveBeenCalled()
  })
})
