/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedDockview } from 'dockview-core'
import type { TerminalListItem } from '@superone/shared/agent-types'
import { setDockApi } from '@/components/activity/activity-panel-api'
import { _resetDockOwnershipForTest } from '@/components/activity/dock-ownership'
import { rememberSessionTerminal, resetSessionTerminalsForTest } from '@/components/activity/session-terminals'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useBrowserStore } from '@/stores/browser'
import { useDeviceInstanceStore } from '@/stores/device-instances'
import { useTerminalStore } from '@/stores/terminal'
import { closeSessionBoundTabs, sessionTabCounts } from './session-bound-tabs'

const kill = vi.fn()
const list = vi.fn(async (): Promise<TerminalListItem[]> => [])

interface FakePanel {
  id: string
  title: string
  params: Record<string, unknown>
  view: { contentComponent: string }
  group: FakeGroup
  api: { close: ReturnType<typeof vi.fn> }
}
interface FakeGroup { id: string; panels: FakePanel[] }

function fakeDock() {
  const group: FakeGroup = { id: 'g0', panels: [] }
  const dock = {
    panels: [] as FakePanel[],
    groups: [group],
    activePanel: undefined as FakePanel | undefined,
    addPanel(options: { id: string; component: string; title?: string; params?: Record<string, unknown> }) {
      const panel: FakePanel = {
        id: options.id,
        title: options.title ?? '',
        params: options.params ?? {},
        view: { contentComponent: options.component },
        group,
        api: {
          close: vi.fn(() => {
            dock.panels = dock.panels.filter((item) => item !== panel)
            group.panels = group.panels.filter((item) => item !== panel)
          }),
        },
      }
      dock.panels.push(panel)
      group.panels.push(panel)
      dock.activePanel = panel
      return panel
    },
    toJSON: () => ({
      grid: {
        root: { type: 'leaf', data: { id: group.id, views: group.panels.map((panel) => panel.id), activeView: group.panels[0]?.id }, size: 100 },
        width: 100,
        height: 100,
        orientation: 'HORIZONTAL',
      },
      panels: Object.fromEntries(group.panels.map((panel) => [panel.id, {
        id: panel.id,
        contentComponent: panel.view.contentComponent,
        title: panel.title,
        params: panel.params,
      }])),
      activeGroup: group.id,
    }),
    clear() { dock.panels = []; group.panels = [] },
    hasMaximizedGroup: () => false,
  }
  setDockApi(dock as never)
  return dock
}

function parkedLayout(): SerializedDockview {
  return {
    grid: {
      root: {
        type: 'leaf',
        data: { views: ['browser-1', 'terminal-t1', 'device-d1', 'file:a.ts'], activeView: 'browser-1', id: 'g1' },
        size: 1,
      },
      height: 100,
      width: 100,
      orientation: 'HORIZONTAL',
    },
    panels: {
      'browser-1': { id: 'browser-1', contentComponent: 'browser', title: 'Docs', params: { browserId: 'browser-1' } },
      'terminal-t1': { id: 'terminal-t1', contentComponent: 'terminal', title: 'shell', params: { terminalId: 't1' } },
      'device-d1': { id: 'device-d1', contentComponent: 'device', title: 'Device', params: { instanceId: 'd1' } },
      'file:a.ts': { id: 'file:a.ts', contentComponent: 'file-preview', title: 'a.ts', params: { filePath: 'a.ts' } },
    },
    activeGroup: 'g1',
  } as unknown as SerializedDockview
}

beforeEach(() => {
  kill.mockReset()
  list.mockReset()
  list.mockResolvedValue([])
  Object.assign(window, { terminal: { kill, list }, environment: { deviceRelease: vi.fn() } })
  _resetDockOwnershipForTest()
  resetSessionTerminalsForTest()
  setDockApi(null)
  useMosaicStore.setState({ mode: 'single', root: null, focusedTileId: null, lastLayout: null })
  useActivityViewStateStore.getState()._resetForTest()
  useBrowserStore.setState({ tabs: {} })
  useDeviceInstanceStore.setState({ byId: {} })
  useTerminalStore.setState({ openBySession: { parked: true, live: true }, byProject: {} })
})

describe('sessionTabCounts', () => {
  it('counts each open kind once, including a browser and an agent terminal not in the layout yet', () => {
    useActivityViewStateStore.setState({
      _currentSessionId: 'live',
      perSession: { parked: { layout: parkedLayout(), showPanel: true } },
    })
    useBrowserStore.getState().ensure('browser-1', 'https://example.com', 'parked')
    useBrowserStore.getState().ensure('browser-2', 'https://example.com/2', 'parked')
    rememberSessionTerminal({ terminalId: 't1', title: 'shell', layoutKey: 'parked' })
    rememberSessionTerminal({ terminalId: 't-agent', title: 'bun', layoutKey: 'parked' })

    expect(sessionTabCounts('parked')).toEqual([
      { kind: 'terminal', count: 2 },
      { kind: 'browser', count: 2 },
      { kind: 'device', count: 1 },
      { kind: 'file', count: 1 },
    ])
  })
})

describe('closeSessionBoundTabs', () => {
  it('releases a parked session without closing the live dock', () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'browser-live', component: 'browser', title: 'Live', params: { browserId: 'browser-live' } })
    useActivityViewStateStore.setState({
      _currentSessionId: 'live',
      perSession: { parked: { layout: parkedLayout(), showPanel: true } },
    })
    useBrowserStore.getState().ensure('browser-1', 'https://example.com', 'parked')
    useBrowserStore.getState().ensure('browser-live', 'https://example.com/live', 'live')
    useDeviceInstanceStore.setState({ byId: { d1: { instanceId: 'd1', sessionId: 'parked', deviceId: null } } })
    rememberSessionTerminal({ terminalId: 't-agent', title: 'bun', layoutKey: 'parked' })
    list.mockResolvedValue([
      { terminalId: 't1', title: 'shell', cwd: '/work', status: 'running', ownerDeviceId: null, agentSessionId: 'parked' },
      { terminalId: 't-agent', title: 'bun', cwd: '/work', status: 'running', ownerDeviceId: null, agentSessionId: 'parked' },
    ] as TerminalListItem[])

    closeSessionBoundTabs('parked')

    expect(dock.panels.map((panel) => panel.id)).toEqual(['browser-live'])
    expect(useBrowserStore.getState().tabs['browser-1']).toBeUndefined()
    expect(useBrowserStore.getState().tabs['browser-live']).toBeDefined()
    expect(useDeviceInstanceStore.getState().byId.d1).toBeUndefined()
    expect(kill).toHaveBeenCalledWith('t1')
    expect(useActivityViewStateStore.getState().perSession.parked).toBeUndefined()
    expect(useTerminalStore.getState().openBySession.parked).toBe(false)
    expect(useTerminalStore.getState().openBySession.live).toBe(true)
    expect(sessionTabCounts('parked')).toEqual([])
  })

  it('closes the tabs of the session on screen and keeps the empty layout', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'browser-live', component: 'browser', title: 'Live', params: { browserId: 'browser-live' } })
    dock.addPanel({ id: 'file:a.ts', component: 'file-preview', title: 'a.ts', params: { filePath: 'a.ts' } })
    useActivityViewStateStore.setState({ _currentSessionId: 'live', perSession: {} })
    useBrowserStore.getState().ensure('browser-live', 'https://example.com', 'live')
    list.mockResolvedValue([])

    closeSessionBoundTabs('live')
    await list.mock.results[0]?.value

    expect(dock.panels).toEqual([])
    expect(useBrowserStore.getState().tabs['browser-live']).toBeUndefined()
    const saved = useActivityViewStateStore.getState().perSession.live?.layout
    expect(saved?.grid.root).toMatchObject({ data: { views: [] } })
    expect(sessionTabCounts('live')).toEqual([])
  })
})
