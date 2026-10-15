/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { ActivityPanel } from './ActivityPanel'
import { getDockApi, openNewFileTab, splitActivityTab } from './activity-panel-api'

type GridNode = { type: 'leaf'; data: { views: string[] } } | { type: 'branch'; data: GridNode[] }

/** The grid as nested arrays of tab ids; depth alternates from the root's orientation. */
function shape(node: GridNode): unknown {
  return node.type === 'leaf' ? node.data.views.join(',') : node.data.map(shape)
}

function grid(): { orientation: string; shape: unknown } {
  const { root, orientation } = getDockApi()!.toJSON().grid
  return { orientation, shape: shape(root as GridNode) }
}

beforeEach(() => {
  Object.assign(window.app, { platform: 'darwin', getFullscreen: async () => false })
  useAppStore.setState({ showSidebar: false, currentFolder: null })
  useActivityPanelStore.setState({ showPanel: true, side: 'left', maximized: false, maximizedGroupId: null })
})

afterEach(cleanup)

async function renderTabs(...paths: string[]) {
  render(<ActivityPanel getMaxWidth={() => 1000} transitionMs={0} />)
  await act(async () => {
    getDockApi()!.layout(1000, 600)
    for (const path of paths) openNewFileTab(path)
  })
}

describe('splitting activity tabs', () => {
  it('turns a top/bottom pair side by side', async () => {
    await renderTabs('README.md', 'CLAUDE.md')
    await act(async () => { splitActivityTab('file:CLAUDE.md', 'below') })
    // A horizontal root holding one vertical branch: README above CLAUDE.
    expect(grid()).toEqual({ orientation: 'HORIZONTAL', shape: [['file:README.md', 'file:CLAUDE.md']] })

    let split = false
    await act(async () => { split = splitActivityTab('file:CLAUDE.md', 'right') })

    expect(split).toBe(true)
    expect(grid()).toEqual({ orientation: 'HORIZONTAL', shape: ['file:README.md', 'file:CLAUDE.md'] })
  })

  it('turns a side-by-side pair top/bottom, from either tab', async () => {
    await renderTabs('README.md', 'CLAUDE.md')
    await act(async () => { splitActivityTab('file:CLAUDE.md', 'right') })

    await act(async () => { splitActivityTab('file:README.md', 'below') })

    // The first group has no group before it, so it goes below the one after it.
    expect(grid()).toEqual({ orientation: 'HORIZONTAL', shape: [['file:CLAUDE.md', 'file:README.md']] })
  })

  it('still splits a tab off a group it shares', async () => {
    await renderTabs('README.md', 'CLAUDE.md')
    await act(async () => { splitActivityTab('file:CLAUDE.md', 'right') })
    expect(getDockApi()!.groups).toHaveLength(2)
  })

  it('refuses the only tab and keeps it', async () => {
    await renderTabs('README.md')
    let split = true
    await act(async () => { split = splitActivityTab('file:README.md', 'right') })
    expect(split).toBe(false)
    expect(getDockApi()!.panels.map((panel) => panel.id)).toEqual(['file:README.md'])
  })

  it('never floats a tab out of the grid on shift-drag', async () => {
    await renderTabs('README.md', 'CLAUDE.md')
    const tab = getDockApi()!.getPanel('file:CLAUDE.md')!.view.tab.element
    await act(async () => { fireEvent.pointerDown(tab, { shiftKey: true, button: 0 }) })
    expect(getDockApi()!.groups.map((group) => group.api.location.type)).toEqual(['grid'])
  })
})
