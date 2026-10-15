/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutControlCaller } from '@superone/shared/layout-control'
import { setDockApi } from '@/components/activity/activity-panel-api'
import { _resetDockOwnershipForTest, dockOpener, recordDockOpener } from '@/components/activity/dock-ownership'
import { miniAppPanelTargetId } from '@superone/shared/miniapp-automation-target'
import { mosaicTileId, useMosaicStore } from '@/components/mosaic/mosaic-store'
import { collectLeaves } from '@/components/mosaic/mosaic-tree'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useTerminalStore } from '@/stores/terminal'
import { LAYOUT } from './layout-constants'
import { layoutAct, layoutSnapshot, openedTabPresentation, openMiniApp } from './layout-control'
import { useMiniAppStore } from '@/stores/miniapp'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'

const PROJECT = '/work/app'
const agentA: LayoutControlCaller = { sessionId: 'A', opener: { kind: 'agent' }, root: PROJECT }

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
    hasMaximizedGroup: () => false,
    exitMaximizedGroup: vi.fn(),
    fromJSON: vi.fn(),
    // One group filling a 600×400 panel.
    toJSON: vi.fn(() => ({
      grid: {
        root: { type: 'branch', size: 400, data: [{ type: 'leaf', size: 600, data: { id: group.id, views: group.panels.map((p) => p.id) } }] },
        width: 600,
        height: 400,
        orientation: 'HORIZONTAL',
      },
      panels: {},
    })),
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
  ;(window as unknown as { app: unknown }).app = { getSessionProject: vi.fn(async () => null) }
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

    const result = await layoutAct(agentA, { action: 'open_file', path: `${PROJECT}/src/main.ts`, line: 12 })

    expect(result).toEqual({ status: 'applied', visible: true, tab: 'file:src/main.ts' })
    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'file:src/main.ts', component: 'file-preview' }))
    const snapshot = layoutSnapshot(agentA)
    expect(snapshot.panel).toMatchObject({ open: true, onScreen: true })
    expect(snapshot.tabs).toEqual([
      { tab: 'file:src/main.ts', kind: 'file', title: 'main.ts', active: true, group: 0, openedBy: 'agent' },
    ])
  })

  it('leaves a tab the user already had as theirs, and can still close it', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'file:src/main.ts', component: 'file-preview', title: 'main.ts' })

    await layoutAct(agentA, { action: 'open_file', path: 'src/main.ts' })

    expect(layoutSnapshot(agentA).tabs[0].openedBy).toBe('user')
    expect(await layoutAct(agentA, { action: 'close_tab', tab: 'file:src/main.ts' })).toMatchObject({ status: 'applied' })
  })

  it('closes a tab it opened', async () => {
    const dock = fakeDock()
    await layoutAct(agentA, { action: 'open_file', path: 'src/main.ts' })
    const panel = dock.panels[0]

    const result = await layoutAct(agentA, { action: 'close_tab', tab: 'file:src/main.ts' })

    expect(result.status).toBe('applied')
    expect(panel.api.close).toHaveBeenCalledOnce()
    expect(layoutSnapshot(agentA).tabs).toEqual([])
  })

  it('names the snapshot when a tab id is unknown', async () => {
    fakeDock()
    await expect(layoutAct(agentA, { action: 'focus_tab', tab: 'browser-nope' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('layout_snapshot') })
  })

  it('collapses the sidebar', async () => {
    fakeDock()
    expect(await layoutAct(agentA, { action: 'hide_sidebar' })).toEqual({ status: 'applied', visible: true })
    expect(useAppStore.getState().showSidebar).toBe(false)
  })

  it('splits tabs into a new group to the right or below', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'file:a.ts', component: 'file-preview', title: 'a.ts' })
    dock.addPanel({ id: 'file:b.ts', component: 'file-preview', title: 'b.ts' })

    await layoutAct(agentA, { action: 'move_tab', tab: 'file:b.ts', direction: 'down' })

    expect(dock.panels[1].api.moveTo).toHaveBeenCalledWith({ group: dock.groups[0], position: 'bottom' })
  })
})

describe('caller in the background', () => {
  beforeEach(() => showSessionInFront('B'))

  it('parks a tab with the caller layout and adds it when that session is shown', async () => {
    const dock = fakeDock()

    const result = await layoutAct(agentA, { action: 'open_file', path: 'src/main.ts' })

    expect(result).toEqual({ status: 'queued', visible: false, tab: 'file:src/main.ts' })
    expect(dock.addPanel).not.toHaveBeenCalled()
    expect(layoutSnapshot(agentA).tabs).toEqual([
      { tab: 'file:src/main.ts', kind: 'file', title: 'main.ts', active: false, group: 0, openedBy: 'agent' },
    ])

    useActivityViewStateStore.getState().restore('A')

    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'file:src/main.ts' }))
  })

  it('opens the panel in the parked layout without touching the one on screen', async () => {
    fakeDock()

    expect(await layoutAct(agentA, { action: 'show_panel' })).toEqual({ status: 'queued', visible: false })

    expect(useActivityPanelStore.getState().showPanel).toBe(false)
    expect(useActivityViewStateStore.getState().perSession.A?.showPanel).toBe(true)
    expect(layoutSnapshot(agentA).panel.open).toBe(true)
  })

  it('refuses window-wide changes so the user is not moved', async () => {
    fakeDock()

    expect(await layoutAct(agentA, { action: 'hide_sidebar' })).toEqual({ status: 'skipped', visible: false, reason: 'not_visible' })
    expect(await layoutAct(agentA, { action: 'panel_side', side: 'right' })).toMatchObject({ status: 'skipped' })
    expect(useAppStore.getState().showSidebar).toBe(true)
    expect(useActivityPanelStore.getState().side).toBe('left')
  })

  it('opens its own bottom terminal for later', async () => {
    expect(await layoutAct(agentA, { action: 'show_terminal' })).toEqual({ status: 'queued', visible: false })
    expect(useTerminalStore.getState().openBySession.A).toBe(true)
  })

  it('reports itself as not visible', () => {
    fakeDock()
    expect(layoutSnapshot(agentA)).toMatchObject({ visible: false, panel: { onScreen: false } })
  })
})

describe('widths', () => {
  const { MIN_SIDEBAR, MAX_SIDEBAR, MIN_AP, MIN_MAIN, CARD_GUTTER } = LAYOUT

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
    useAppStore.setState({ sidebarWidth: 320 })
    useActivityPanelStore.setState({ showPanel: true, panelWidth: 560, userResized: false })
    fakeDock()
  })

  it('reports each column with the range it can take while the others stay put', () => {
    expect(layoutSnapshot(agentA).sizes).toEqual({
      window: 1600,
      sidebar: { width: 320, min: MIN_SIDEBAR, max: Math.min(MAX_SIDEBAR, 1600 - 560 - MIN_MAIN - CARD_GUTTER) },
      panel: { width: 560, min: MIN_AP, max: 1600 - 320 - MIN_MAIN - CARD_GUTTER },
      chat: { width: 1600 - 320 - 560 - CARD_GUTTER, min: MIN_MAIN },
    })
  })

  it('narrows the chat by widening the panel, clamped to what the chat can spare', async () => {
    const max = 1600 - 320 - MIN_MAIN - CARD_GUTTER

    expect(await layoutAct(agentA, { action: 'resize_panel', width: 5000 })).toEqual({ status: 'applied', visible: true, width: max })
    expect(useActivityPanelStore.getState()).toMatchObject({ panelWidth: max, userResized: true })
    expect(layoutSnapshot(agentA).sizes.chat.width).toBe(MIN_MAIN)
  })

  it('resizes the sidebar within its bounds', async () => {
    expect(await layoutAct(agentA, { action: 'resize_sidebar', width: 100 })).toMatchObject({ status: 'applied', width: MIN_SIDEBAR })
    expect(await layoutAct(agentA, { action: 'resize_sidebar', width: 420.4 })).toMatchObject({ width: 420 })
    expect(useAppStore.getState().sidebarWidth).toBe(420)
  })

  it('counts no chat width under a maximized panel', () => {
    useActivityPanelStore.setState({ maximized: true })
    expect(layoutSnapshot(agentA).sizes.chat.width).toBe(0)
  })

  it('needs a width', async () => {
    await expect(layoutAct(agentA, { action: 'resize_panel' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('leaves widths alone while the caller is in the background', async () => {
    showSessionInFront('B')
    expect(await layoutAct(agentA, { action: 'resize_sidebar', width: 400 })).toMatchObject({ status: 'skipped' })
    expect(useAppStore.getState().sidebarWidth).toBe(320)
  })
})

describe('chat mode', () => {
  beforeEach(() => {
    useChatStore.setState({ isOpen: false })
    useActivityPanelStore.setState({ chatFloating: false })
  })

  it('floats the chat over the whole panel without maximizing a tab, iconifies it, and docks it back', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'file:a.ts', component: 'file-preview', title: 'a.ts' })
    expect(layoutSnapshot(agentA).chatMode).toBe('docked')

    expect(await layoutAct(agentA, { action: 'chat_mode', mode: 'floating' })).toEqual({ status: 'applied', visible: true })
    expect(dock.panels[0].api.maximize).not.toHaveBeenCalled()
    expect(useActivityPanelStore.getState()).toMatchObject({ showPanel: true, chatFloating: true, maximized: false })
    expect(layoutSnapshot(agentA)).toMatchObject({ chatMode: 'floating', sizes: { chat: { width: 0 } } })

    await layoutAct(agentA, { action: 'chat_mode', mode: 'icon' })
    expect(layoutSnapshot(agentA).chatMode).toBe('icon')

    await layoutAct(agentA, { action: 'chat_mode', mode: 'docked' })
    expect(layoutSnapshot(agentA).chatMode).toBe('docked')
  })

  it('floats over an empty panel too', async () => {
    fakeDock()
    expect(await layoutAct(agentA, { action: 'chat_mode', mode: 'icon' })).toMatchObject({ status: 'applied' })
    expect(layoutSnapshot(agentA).chatMode).toBe('icon')
  })

  it('docks the chat out of a maximized tab', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'file:a.ts', component: 'file-preview', title: 'a.ts' })
    await layoutAct(agentA, { action: 'maximize_panel' })
    expect(layoutSnapshot(agentA).chatMode).not.toBe('docked')

    await layoutAct(agentA, { action: 'chat_mode', mode: 'docked' })
    expect(useActivityPanelStore.getState().maximized).toBe(false)
    expect(layoutSnapshot(agentA).chatMode).toBe('docked')
  })

  it('docks again when the panel is hidden', async () => {
    fakeDock()
    await layoutAct(agentA, { action: 'chat_mode', mode: 'floating' })
    await layoutAct(agentA, { action: 'hide_panel' })
    expect(layoutSnapshot(agentA).chatMode).toBe('docked')
  })

  it('snaps the floating chat to a named position, alone or with a mode', async () => {
    fakeDock()
    useChatStore.setState({ corner: 'br' })
    expect(layoutSnapshot(agentA).chatPosition).toBe('bottom-right')

    expect(await layoutAct(agentA, { action: 'chat_mode', mode: 'floating', position: 'top' })).toEqual({ status: 'applied', visible: true })
    expect(useChatStore.getState().corner).toBe('tm')

    await layoutAct(agentA, { action: 'chat_mode', position: 'left' })
    expect(layoutSnapshot(agentA)).toMatchObject({ chatMode: 'floating', chatPosition: 'left' })
  })

  it('remembers a position set while docked', async () => {
    fakeDock()
    expect(await layoutAct(agentA, { action: 'chat_mode', position: 'top-left' })).toEqual({ status: 'applied', visible: false })
    expect(layoutSnapshot(agentA)).toMatchObject({ chatMode: 'docked', chatPosition: 'top-left' })
  })

  it('needs a mode or a position, and a known one', async () => {
    fakeDock()
    await expect(layoutAct(agentA, { action: 'chat_mode' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(layoutAct(agentA, { action: 'chat_mode', position: 'center' as never })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('rejects an unknown mode and skips while the caller is in the background', async () => {
    fakeDock()
    await expect(layoutAct(agentA, { action: 'chat_mode', mode: 'pip' as never })).rejects.toMatchObject({ code: 'invalid' })
    showSessionInFront('B')
    expect(await layoutAct(agentA, { action: 'chat_mode', mode: 'floating' })).toMatchObject({ status: 'skipped' })
  })
})

describe('where an agent-opened tab shows', () => {
  it('is in the panel only while the panel is on screen', () => {
    fakeDock()
    useActivityPanelStore.setState({ showPanel: true })
    expect(openedTabPresentation('A', true)).toBe('panel')
  })

  it('falls back to the picture-in-picture for kinds that have one, else out of sight', () => {
    fakeDock()
    expect(openedTabPresentation('A', true)).toBe('pip')
    expect(openedTabPresentation('A', false)).toBe('background')
  })

  it('is out of sight while the caller is in the background', () => {
    fakeDock()
    showSessionInFront('B')
    expect(openedTabPresentation('A', true)).toBe('background')
  })
})

describe('opening a mini-app for the agent', () => {
  const entry = { id: 'notes', manifest: { name: 'Notes' } }
  let openAppInPanel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(window as unknown as { miniapp: unknown }).miniapp = { list: vi.fn(async () => [entry]) }
    openAppInPanel = vi.fn(async () => {})
    useMiniAppStore.setState({ openAppInPanel } as never)
    useAgentViewfinderStore.setState({ activeBySession: {} })
    useAppStore.setState({ currentFolder: PROJECT, currentProjectId: 'p1', recentFolders: [] } as never)
  })

  it('opens it in the caller\'s panel without revealing it, as the caller\'s own tab', async () => {
    fakeDock()
    const result = await openMiniApp(agentA, 'notes', PROJECT)

    expect(result).toEqual({ status: 'applied', visible: false, tab: 'miniapp-notes:p1', name: 'Notes', presentation: 'pip' })
    expect(openAppInPanel).toHaveBeenCalledWith(entry, PROJECT, { reveal: false, sessionId: 'A' })
    // The session's picture-in-picture shows its viewfinder target while the panel is closed.
    expect(useAgentViewfinderStore.getState().activeBySession.A).toEqual({ kind: 'miniapp', targetId: miniAppPanelTargetId('notes') })
    // Recorded as the agent's, so close_tab may close it later.
    expect(dockOpener('A', 'miniapp-notes:p1')).toBe('agent')
  })

  it('waits for the caller in the background instead of opening it in someone else\'s layout', async () => {
    fakeDock()
    showSessionInFront('B')
    expect(await openMiniApp(agentA, 'notes', PROJECT)).toMatchObject({ status: 'queued', presentation: 'background' })
    expect(openAppInPanel).not.toHaveBeenCalled()
  })

  it('reports a launch that fails instead of a tab that never appears', async () => {
    fakeDock()
    openAppInPanel.mockRejectedValueOnce(new Error('App not found: notes'))
    await expect(openMiniApp(agentA, 'notes', PROJECT)).rejects.toThrow('App not found: notes')
    expect(useAgentViewfinderStore.getState().activeBySession.A).toBeUndefined()
  })

  it('names miniapp_list for an app that is not installed', async () => {
    await expect(openMiniApp(agentA, 'ghost', PROJECT)).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('miniapp_list') })
  })
})

describe('session split', () => {
  it('reports a session that does not exist', async () => {
    await expect(layoutAct(agentA, { action: 'split_session', sessionId: 'X' })).rejects.toMatchObject({ code: 'not_found' })
    expect(useMosaicStore.getState().mode).toBe('single')
  })

  it('adds another session beside itself without moving focus, and any caller can close that pane', async () => {
    vi.mocked(window.app.getSessionProject).mockResolvedValue(PROJECT)

    expect(await layoutAct(agentA, { action: 'split_session', sessionId: 'C' })).toEqual({ status: 'applied', visible: true })

    const mosaic = useMosaicStore.getState()
    expect(mosaic.mode).toBe('mosaic')
    expect(collectLeaves(mosaic.root!).map((leaf) => leaf.sessionId)).toEqual(['A', 'C'])
    expect(mosaic.focusedTileId).toBe(mosaicTileId(PROJECT, 'A'))
    expect(useChatStore.getState().switchToSession).not.toHaveBeenCalled()
    expect(layoutSnapshot(agentA).window).toMatchObject({ layout: 'split', splitSessions: ['A', 'C'] })

    await expect(layoutAct(agentA, { action: 'close_split', sessionId: 'A' })).rejects.toMatchObject({ code: 'invalid' })

    const miniApp: LayoutControlCaller = { sessionId: 'A', opener: { kind: 'miniapp', appId: 'demo' } }
    await layoutAct(miniApp, { action: 'close_split', sessionId: 'C' })
    expect(useMosaicStore.getState().mode).toBe('single')
  })
})

describe('tab ids', () => {
  it('names terminals by the id terminal_tabs uses and accepts it back', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'terminal-t7', component: 'terminal', title: 'dev', params: { terminalId: 't7' } })

    expect(layoutSnapshot(agentA).tabs[0]).toMatchObject({ tab: 't7', kind: 'terminal' })
    expect(await layoutAct(agentA, { action: 'focus_tab', tab: 't7' })).toMatchObject({ status: 'applied', tab: 't7' })
  })
})

describe('mini-app caller', () => {
  it('finds its own tab and can close what the agent opened', async () => {
    const dock = fakeDock()
    dock.addPanel({ id: 'miniapp-demo:p1', component: 'miniapp', title: 'Demo' })
    dock.addPanel({ id: 'browser-1', component: 'browser', title: 'Docs' })
    recordDockOpener('A', 'browser-1', 'agent')
    const miniApp: LayoutControlCaller = { sessionId: 'A', opener: { kind: 'miniapp', appId: 'demo', instanceKey: 'demo:p1' } }

    expect(layoutSnapshot(miniApp).self).toBe('miniapp-demo:p1')
    expect(await layoutAct(miniApp, { action: 'maximize_panel', tab: 'miniapp-demo:p1' })).toMatchObject({ status: 'applied' })
    expect(await layoutAct(miniApp, { action: 'close_tab', tab: 'browser-1' })).toMatchObject({ status: 'applied' })
  })
})
