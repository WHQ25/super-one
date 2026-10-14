/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiControlCaller } from '@superone/shared/ui-control'
import { setDockApi } from '@/components/activity/activity-panel-api'
import { _resetDockOwnershipForTest, recordDockOpener } from '@/components/activity/dock-ownership'
import { mosaicTileId, useMosaicStore } from '@/components/mosaic/mosaic-store'
import { collectLeaves } from '@/components/mosaic/mosaic-tree'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useTerminalStore } from '@/stores/terminal'
import { uiAct, uiSnapshot } from './ui-control'

const PROJECT = '/work/app'
const agentA: UiControlCaller = { sessionId: 'A', opener: { kind: 'agent' }, root: PROJECT }

interface FakePanel {
  id: string
  title: string
  params: Record<string, unknown>
  view: { contentComponent: string }
  group: FakeGroup
  api: Record<string, ReturnType<typeof vi.fn> | boolean | (() => boolean)>
}
interface FakeGroup { id: string; panels: FakePanel[] }

/** Just enough dockview for the opener and close paths: one group, adds and closes. */
function fakeDock() {
  const group: FakeGroup = { id: 'g0', panels: [] }
  const dock = {
    panels: [] as FakePanel[],
    groups: [group],
    activePanel: undefined as FakePanel | undefined,
    addPanel: vi.fn((options: { id: string; component: string; title: string; params?: Record<string, unknown> }) => {
      const panel: FakePanel = {
        id: options.id,
        title: options.title,
        params: options.params ?? {},
        view: { contentComponent: options.component },
        group,
        api: {
          isActive: false,
          isMaximized: () => false,
          setActive: vi.fn(() => { dock.activePanel = panel }),
          maximize: vi.fn(),
          exitMaximized: vi.fn(),
          moveTo: vi.fn(),
          close: vi.fn(() => {
            dock.panels = dock.panels.filter((p) => p !== panel)
            group.panels = group.panels.filter((p) => p !== panel)
          }),
        },
      }
      dock.panels.push(panel)
      group.panels.push(panel)
      dock.activePanel = panel
      return panel
    }),
    clear: vi.fn(() => { dock.panels = []; group.panels = [] }),
    fromJSON: vi.fn(),
    toJSON: vi.fn(() => null),
  }
  setDockApi(dock as never)
  return dock
}

function showSessionInFront(sessionId: string) {
  useChatStore.setState({
    activeProject: PROJECT,
    projectSessions: { [PROJECT]: { _activeSessionId: sessionId, _sessions: {} } } as never,
  })
  useActivityViewStateStore.setState({ _currentSessionId: sessionId })
}

beforeEach(() => {
  _resetDockOwnershipForTest()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  ;(window as unknown as { terminal: unknown }).terminal = { list: vi.fn(async () => []) }
  ;(window as unknown as { app: unknown }).app = { getSpawnedSessionProject: vi.fn(async () => null) }
  useAppStore.setState({ view: 'main', showSidebar: true })
  useActivityPanelStore.setState({ showPanel: false, side: 'left', maximized: false, maximizedGroupId: null, userResized: true })
  useActivityViewStateStore.getState()._resetForTest()
  useMosaicStore.setState({ mode: 'single', root: null, focusedTileId: null, lastLayout: null })
  useTerminalStore.setState({ openBySession: {} })
  useChatStore.setState({ mountSession: vi.fn(async () => {}), switchToSession: vi.fn(async () => {}), unmountSession: vi.fn() } as never)
  showSessionInFront('A')
})

afterEach(() => {
  setDockApi(null)
})

describe('caller in front', () => {
  it('opens a file tab, shows the panel, and marks it as opened by the agent', async () => {
    const dock = fakeDock()

    const result = await uiAct(agentA, { action: 'open_file', path: `${PROJECT}/src/main.ts`, line: 12 })

    expect(result).toEqual({ status: 'applied', visible: true, tab: 'file:src/main.ts' })
    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'file:src/main.ts', component: 'file-preview' }))
    const snapshot = uiSnapshot(agentA)
    expect(snapshot.panel).toMatchObject({ open: true, onScreen: true })
    expect(snapshot.tabs).toEqual([
      { tab: 'file:src/main.ts', kind: 'file', title: 'main.ts', active: true, group: 0, openedBy: 'agent' },
    ])
  })

  it('opens a commit diff against the caller folder', async () => {
    const dock = fakeDock()

    const result = await uiAct(agentA, { action: 'open_diff', commit: 'abc1234' })

    expect(result.tab).toBe('diff:abc1234')
    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({ component: 'diff', params: { root: PROJECT, commit: 'abc1234' } }))
  })

  it('leaves a tab the user already had as theirs', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'file:src/main.ts', component: 'file-preview', title: 'main.ts' })

    await uiAct(agentA, { action: 'open_file', path: 'src/main.ts' })

    expect(uiSnapshot(agentA).tabs[0].openedBy).toBe('user')
    await expect(uiAct(agentA, { action: 'close_tab', tab: 'file:src/main.ts' })).rejects.toMatchObject({ code: 'not_owned' })
  })

  it('closes a tab it opened', async () => {
    const dock = fakeDock()
    await uiAct(agentA, { action: 'open_diff' })
    const panel = dock.panels[0]

    const result = await uiAct(agentA, { action: 'close_tab', tab: 'diff:uncommitted' })

    expect(result.status).toBe('applied')
    expect(panel.api.close).toHaveBeenCalledOnce()
    expect(uiSnapshot(agentA).tabs).toEqual([])
  })

  it('names the snapshot when a tab id is unknown', async () => {
    fakeDock()
    await expect(uiAct(agentA, { action: 'focus_tab', tab: 'browser-nope' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('ui_snapshot') })
  })

  it('collapses the sidebar', async () => {
    fakeDock()
    expect(await uiAct(agentA, { action: 'hide_sidebar' })).toEqual({ status: 'applied', visible: true })
    expect(useAppStore.getState().showSidebar).toBe(false)
  })

  it('splits tabs into a new group to the right or below', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'file:a.ts', component: 'file-preview', title: 'a.ts' })
    dock.addPanel({ id: 'file:b.ts', component: 'file-preview', title: 'b.ts' })

    await uiAct(agentA, { action: 'split_tab', tab: 'file:b.ts', direction: 'down' })

    expect(dock.panels[1].api.moveTo).toHaveBeenCalledWith({ group: dock.groups[0], position: 'bottom' })
  })
})

describe('caller in the background', () => {
  beforeEach(() => showSessionInFront('B'))

  it('parks a tab with the caller layout and adds it when that session is shown', async () => {
    const dock = fakeDock()

    const result = await uiAct(agentA, { action: 'open_file', path: 'src/main.ts' })

    expect(result).toEqual({ status: 'queued', visible: false, tab: 'file:src/main.ts' })
    expect(dock.addPanel).not.toHaveBeenCalled()
    expect(uiSnapshot(agentA).tabs).toEqual([
      { tab: 'file:src/main.ts', kind: 'file', title: 'main.ts', active: false, group: 0, openedBy: 'agent' },
    ])

    useActivityViewStateStore.getState().restore('A')

    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'file:src/main.ts' }))
  })

  it('opens the panel in the parked layout without touching the one on screen', async () => {
    fakeDock()

    expect(await uiAct(agentA, { action: 'show_panel' })).toEqual({ status: 'queued', visible: false })

    expect(useActivityPanelStore.getState().showPanel).toBe(false)
    expect(useActivityViewStateStore.getState().perSession.A?.showPanel).toBe(true)
    expect(uiSnapshot(agentA).panel.open).toBe(true)
  })

  it('refuses window-wide changes so the user is not moved', async () => {
    fakeDock()

    expect(await uiAct(agentA, { action: 'hide_sidebar' })).toEqual({ status: 'skipped', visible: false, reason: 'not_visible' })
    expect(await uiAct(agentA, { action: 'panel_side', side: 'right' })).toMatchObject({ status: 'skipped' })
    expect(useAppStore.getState().showSidebar).toBe(true)
    expect(useActivityPanelStore.getState().side).toBe('left')
  })

  it('opens its own bottom terminal for later', async () => {
    expect(await uiAct(agentA, { action: 'show_terminal' })).toEqual({ status: 'queued', visible: false })
    expect(useTerminalStore.getState().openBySession.A).toBe(true)
  })

  it('reports itself as not visible', () => {
    fakeDock()
    expect(uiSnapshot(agentA)).toMatchObject({ visible: false, panel: { onScreen: false } })
  })
})

describe('session split', () => {
  it('refuses a session it did not launch', async () => {
    await expect(uiAct(agentA, { action: 'split_session', sessionId: 'X' })).rejects.toMatchObject({ code: 'not_child' })
    expect(useMosaicStore.getState().mode).toBe('single')
  })

  it('adds its child beside itself without moving focus, and only it can close that pane', async () => {
    vi.mocked(window.app.getSpawnedSessionProject).mockResolvedValue(PROJECT)

    expect(await uiAct(agentA, { action: 'split_session', sessionId: 'C' })).toEqual({ status: 'applied', visible: true })

    const mosaic = useMosaicStore.getState()
    expect(mosaic.mode).toBe('mosaic')
    expect(collectLeaves(mosaic.root!).map((leaf) => leaf.sessionId)).toEqual(['A', 'C'])
    expect(mosaic.focusedTileId).toBe(mosaicTileId(PROJECT, 'A'))
    expect(useChatStore.getState().switchToSession).not.toHaveBeenCalled()
    expect(uiSnapshot(agentA).window).toMatchObject({ layout: 'split', splitSessions: ['A', 'C'] })

    const miniApp: UiControlCaller = { sessionId: 'A', opener: { kind: 'miniapp', appId: 'demo' } }
    await expect(uiAct(miniApp, { action: 'close_split', sessionId: 'C' })).rejects.toMatchObject({ code: 'not_owned' })

    await uiAct(agentA, { action: 'close_split', sessionId: 'C' })
    expect(useMosaicStore.getState().mode).toBe('single')
  })
})

describe('mini-app caller', () => {
  it('finds its own tab and cannot close what the agent opened', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'miniapp-demo:p1', component: 'miniapp', title: 'Demo' })
    dock.addPanel({ id: 'browser-1', component: 'browser', title: 'Docs' })
    recordDockOpener('A', 'browser-1', 'agent')
    const miniApp: UiControlCaller = { sessionId: 'A', opener: { kind: 'miniapp', appId: 'demo', instanceKey: 'demo:p1' } }

    expect(uiSnapshot(miniApp).self).toBe('miniapp-demo:p1')
    await expect(uiAct(miniApp, { action: 'close_tab', tab: 'browser-1' })).rejects.toMatchObject({ code: 'not_owned' })
    expect(await uiAct(miniApp, { action: 'maximize_panel', tab: 'miniapp-demo:p1' })).toMatchObject({ status: 'applied' })
  })
})
