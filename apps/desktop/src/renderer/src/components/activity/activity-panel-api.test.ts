/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openFileTab,
  openBrowserTab,
  openMiniAppTab,
  closeBrowserTab,
  beginMosaicRecording,
  replayMosaicOpenedPanels,
  setDockApi,
} from './activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useBrowserStore } from '@/stores/browser'

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
