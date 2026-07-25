/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openFileTab,
  openNewFileTab,
  openBrowserTab,
  openMiniAppTab,
  closeBrowserTab,
  beginMosaicRecording,
  replayMosaicOpenedPanels,
  materializeOwnedBrowserTabs,
  maximizeActivityPanel,
  toggleMaximizedActivityGroup,
  setCurrentSessionIdGetter,
  setDockApi,
} from './activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useBrowserStore } from '@/stores/browser'

afterEach(() => {
  setDockApi(null)
  useActivityPanelStore.setState({
    showPanel: false,
    maximized: false,
    maximizedGroupId: null,
  })
})

describe('openFileTab', () => {
  beforeEach(() => {
    useActivityPanelStore.setState({ showPanel: false, side: 'left', panelWidth: 560 })
  })

  it('strips the trailing line suffix before opening a file preview panel', () => {
    const addPanel = vi.fn()
    setDockApi({
      panels: [],
      activePanel: undefined,
      addPanel,
    } as never)

    openFileTab('src/app.ts:12')

    expect(useActivityPanelStore.getState().showPanel).toBe(true)
    expect(addPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file:src/app.ts',
      title: 'app.ts',
      params: { filePath: 'src/app.ts' },
    }))
  })
})

describe('maximizeActivityPanel', () => {
  beforeEach(() => {
    useActivityPanelStore.setState({ showPanel: false, hasPanels: true, maximized: false, maximizedGroupId: null })
  })

  it('shows the activity area and maximizes the active Dockview group', () => {
    const maximize = vi.fn()
    const group = { id: 'group-a', panels: [] }
    const panel = {
      id: 'browser-a',
      group,
      api: { isMaximized: () => false, maximize, exitMaximized: vi.fn() },
    }
    setDockApi({ panels: [panel], groups: [group], activePanel: panel } as never)

    maximizeActivityPanel()

    expect(maximize).toHaveBeenCalledOnce()
    expect(useActivityPanelStore.getState()).toMatchObject({
      showPanel: true,
      hasPanels: true,
      maximized: true,
      maximizedGroupId: 'group-a',
    })
  })

  it('toggles the maximized group from the tab action', () => {
    let maximized = false
    const maximize = vi.fn(() => { maximized = true })
    const exitMaximized = vi.fn(() => { maximized = false })
    const group = { id: 'group-a', panels: [] }
    const panel = {
      id: 'browser-a',
      group,
      api: { isMaximized: () => maximized, maximize, exitMaximized },
    }
    setDockApi({ panels: [panel], groups: [group], activePanel: panel } as never)

    toggleMaximizedActivityGroup('browser-a')
    expect(useActivityPanelStore.getState().maximizedGroupId).toBe('group-a')

    toggleMaximizedActivityGroup('browser-a')

    expect(exitMaximized).toHaveBeenCalledOnce()
    expect(useActivityPanelStore.getState().maximizedGroupId).toBeNull()
  })
})

describe('opening tabs while a group is maximized', () => {
  const targetGroup = { id: 'group-target', panels: [] as unknown[] }

  beforeEach(() => {
    useActivityPanelStore.setState({
      showPanel: true,
      side: 'left',
      panelWidth: 560,
      maximized: true,
      maximizedGroupId: targetGroup.id,
    })
    useBrowserStore.setState({ tabs: {}, slots: {} })
  })

  it('adds new tabs inside the maximized group even when a split was requested', () => {
    const addPanel = vi.fn()
    setDockApi({ panels: [], groups: [targetGroup], activePanel: undefined, addPanel } as never)

    openNewFileTab('src/new.ts', { direction: 'right' })
    openBrowserTab('example.com', 'browser-new')
    openMiniAppTab('app-a::proj', 'app-a', 'App A')

    expect(addPanel).toHaveBeenCalledTimes(3)
    for (const [options] of addPanel.mock.calls) {
      expect(options.position).toEqual({ referenceGroup: targetGroup, direction: 'within' })
    }
  })

  it('moves an existing duplicate tab out of a hidden group', () => {
    const moveTo = vi.fn()
    const setActive = vi.fn()
    const sourceGroup = { id: 'group-hidden', panels: [] }
    const panel = {
      id: 'file:src/existing.ts',
      group: sourceGroup,
      api: { moveTo, setActive },
    }
    setDockApi({ panels: [panel], groups: [targetGroup], activePanel: panel, addPanel: vi.fn() } as never)

    openFileTab('src/existing.ts')

    expect(moveTo).toHaveBeenCalledWith({ group: targetGroup, index: 0, skipSetActive: false })
    expect(setActive).toHaveBeenCalledOnce()
  })
})

describe('mosaic-opened panels survive the return to single', () => {
  function fakeDock() {
    const panels: { id: string; api: { setActive: () => void; close: () => void } }[] = []
    const addPanel = vi.fn((spec: { id: string }) => {
      panels.push({ id: spec.id, api: { setActive: vi.fn(), close: vi.fn() } })
    })
    setDockApi({ panels, activePanel: undefined, addPanel } as never)
    return { panels, addPanel }
  }

  beforeEach(() => {
    useActivityPanelStore.setState({ showPanel: false, side: 'left', panelWidth: 560 })
    useBrowserStore.setState({ tabs: {}, slots: {} })
    replayMosaicOpenedPanels() // reset any recording state from prior tests
  })

  it('replays a browser opened during mosaic after the exit restore clobbers the dock', () => {
    const dock = fakeDock()
    beginMosaicRecording()

    openBrowserTab('example.com', 'browser-x')
    expect(dock.addPanel).toHaveBeenCalledTimes(1)
    expect(useBrowserStore.getState().tabs['browser-x']).toBeTruthy()

    // Simulate mosaic exit: restore clobbers the live dock, then we replay.
    dock.panels.length = 0
    useActivityPanelStore.setState({ showPanel: false })

    replayMosaicOpenedPanels()

    expect(dock.panels.some((p) => p.id === 'browser-x')).toBe(true)
    expect(useActivityPanelStore.getState().showPanel).toBe(true)
  })

  it('replays a mini-app opened during mosaic', () => {
    const dock = fakeDock()
    beginMosaicRecording()

    openMiniAppTab('app-a::proj', 'app-a', 'App A')
    expect(dock.addPanel).toHaveBeenCalledTimes(1)

    dock.panels.length = 0
    replayMosaicOpenedPanels()

    expect(dock.panels.some((p) => p.id === 'miniapp-app-a::proj')).toBe(true)
  })

  it('does not replay a browser that was closed during mosaic', () => {
    const dock = fakeDock()
    beginMosaicRecording()

    openBrowserTab('example.com', 'browser-x')
    closeBrowserTab('browser-x')

    dock.panels.length = 0
    replayMosaicOpenedPanels()

    expect(dock.panels.some((p) => p.id === 'browser-x')).toBe(false)
  })

  it('records nothing when a browser is opened outside mosaic', () => {
    const dock = fakeDock()
    openBrowserTab('example.com', 'browser-y')

    dock.panels.length = 0
    replayMosaicOpenedPanels()

    expect(dock.panels.length).toBe(0)
  })
})

describe('Cmd/Ctrl+click opens a browser tab in the background', () => {
  function fakeDock() {
    const panels: { id: string; api: { setActive: ReturnType<typeof vi.fn>; close: () => void } }[] = []
    const addPanel = vi.fn((spec: { id: string }) => {
      panels.push({ id: spec.id, api: { setActive: vi.fn(), close: vi.fn() } })
    })
    setDockApi({ panels, activePanel: undefined, addPanel } as never)
    return { panels, addPanel }
  }

  beforeEach(() => {
    useActivityPanelStore.setState({ showPanel: false, side: 'left', panelWidth: 560 })
    useBrowserStore.setState({ tabs: {}, slots: {} })
  })

  it('adds the new panel inactive so focus stays on the current tab', () => {
    const dock = fakeDock()

    openBrowserTab('example.com', 'browser-bg', null, { background: true })

    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'browser-bg', inactive: true }))
  })

  it('does not steal focus when the background target tab already exists', () => {
    const dock = fakeDock()
    openBrowserTab('example.com', 'browser-bg')
    const created = dock.panels.find((p) => p.id === 'browser-bg')!
    created.api.setActive.mockClear()

    openBrowserTab('example.com', 'browser-bg', null, { background: true })

    expect(created.api.setActive).not.toHaveBeenCalled()
  })
})

describe('browser tabs stay confined to their owner session', () => {
  function fakeDock() {
    const panels: { id: string; api: { setActive: () => void; close: () => void } }[] = []
    const addPanel = vi.fn((spec: { id: string }) => {
      panels.push({ id: spec.id, api: { setActive: vi.fn(), close: vi.fn() } })
    })
    setDockApi({ panels, activePanel: undefined, addPanel } as never)
    return { panels, addPanel }
  }

  beforeEach(() => {
    useActivityPanelStore.setState({ showPanel: false, side: 'left', panelWidth: 560 })
    useBrowserStore.setState({ tabs: {}, slots: {} })
    setCurrentSessionIdGetter(() => 'sess-visible')
  })

  afterEach(() => {
    setCurrentSessionIdGetter(null)
  })

  it('registers a background tab without adding it to the on-screen dock', () => {
    const dock = fakeDock()

    // sess-hidden's agent opens a tab while the user is viewing sess-visible.
    openBrowserTab('example.com', 'browser-bg', 'sess-hidden')

    expect(useBrowserStore.getState().tabs['browser-bg']).toMatchObject({ owner: 'sess-hidden' })
    expect(dock.addPanel).not.toHaveBeenCalled()
    expect(useActivityPanelStore.getState().showPanel).toBe(false)
  })

  it('adds a tab to the live dock when its owner is the on-screen session', () => {
    const dock = fakeDock()

    openBrowserTab('example.com', 'browser-fg', 'sess-visible')

    expect(dock.addPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 'browser-fg' }))
    expect(useActivityPanelStore.getState().showPanel).toBe(true)
  })

  it('materializes a background tab into its owner panel on restore, skipping foreign and existing panels', () => {
    const dock = fakeDock()
    openBrowserTab('example.com', 'browser-bg', 'sess-hidden')
    openBrowserTab('other.com', 'browser-foreign', 'sess-other')
    expect(dock.addPanel).not.toHaveBeenCalled()

    materializeOwnedBrowserTabs('sess-hidden')

    expect(dock.panels.map((p) => p.id)).toEqual(['browser-bg'])
    expect(useActivityPanelStore.getState().showPanel).toBe(true)

    // Idempotent: a second restore does not duplicate the already-present panel.
    materializeOwnedBrowserTabs('sess-hidden')
    expect(dock.panels.map((p) => p.id)).toEqual(['browser-bg'])
  })
})
