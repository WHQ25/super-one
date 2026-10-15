/** @vitest-environment jsdom */

import { act, cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { WindowsTitleBar } from '@/components/WindowsTitleBar'
import { ActivityPanel } from './ActivityPanel'
import { getDockApi, openNewFileTab, splitActivityTab } from './activity-panel-api'

beforeEach(() => {
  Object.assign(window.app, { platform: 'darwin', getFullscreen: async () => false })
  useAppStore.setState({ showSidebar: false, currentFolder: null })
  useActivityPanelStore.setState({ showPanel: true, side: 'left', maximized: false, maximizedGroupId: null })
})

afterEach(cleanup)

async function renderSplit(direction: 'right' | 'below' = 'right') {
  const view = render(<ActivityPanel getMaxWidth={() => 1000} transitionMs={0} />)
  await act(async () => {
    getDockApi()!.layout(1000, 600)
    openNewFileTab('README.md')
    openNewFileTab('CLAUDE.md')
    splitActivityTab('file:CLAUDE.md', direction)
  })
  return view
}

function expectMacControls(view: ReturnType<typeof render>, owner: string, maximized = false) {
  const api = getDockApi()!
  expect(view.getAllByRole('button', { name: /toggle sidebar/i })).toHaveLength(1)
  expect(view.container.querySelectorAll('.lucide-panel-right-open')).toHaveLength(maximized ? 0 : 1)
  expect(view.container.querySelectorAll('[data-traffic-light-padding]')).toHaveLength(1)
  for (const group of api.groups) {
    const buttons = within(group.element).queryAllByRole('button', { name: /toggle sidebar/i })
    expect(buttons).toHaveLength(group === api.getPanel(owner)!.group ? 1 : 0)
  }
}

describe('activity split header controls', () => {
  it.each(['right', 'below'] as const)('keeps one set of window controls after a %s split', async (direction) => {
    const view = await renderSplit(direction)
    expect(getDockApi()!.groups).toHaveLength(2)
    expectMacControls(view, 'file:README.md')
  })

  it('follows the top-left group through reordering, nested splits and closing', async () => {
    const view = await renderSplit()
    const api = getDockApi()!
    await act(async () => {
      api.getPanel('file:CLAUDE.md')!.group.api.moveTo({ group: api.getPanel('file:README.md')!.group, position: 'left' })
    })
    // The first-created group is still README; visual order is now CLAUDE, README.
    expect(api.groups[0]).toBe(api.getPanel('file:README.md')!.group)
    expectMacControls(view, 'file:CLAUDE.md')

    await act(async () => {
      openNewFileTab('AGENTS.md')
      splitActivityTab('file:AGENTS.md', 'below')
    })
    expect(api.groups).toHaveLength(3)
    expectMacControls(view, 'file:CLAUDE.md')

    await act(async () => { api.getPanel('file:CLAUDE.md')!.api.close() })
    expect(api.groups).toHaveLength(2)
    expectMacControls(view, 'file:AGENTS.md')
  })

  it('moves controls to a maximized non-corner group and back on restore', async () => {
    const view = await renderSplit()
    const api = getDockApi()!
    await act(async () => { api.getPanel('file:CLAUDE.md')!.api.maximize() })
    expectMacControls(view, 'file:CLAUDE.md', true)

    await act(async () => { api.getPanel('file:CLAUDE.md')!.api.exitMaximized() })
    expectMacControls(view, 'file:README.md')
  })

  it('restores the control owner when a saved split layout is reloaded', async () => {
    const view = await renderSplit()
    const api = getDockApi()!
    await act(async () => {
      api.getPanel('file:CLAUDE.md')!.group.api.moveTo({ group: api.getPanel('file:README.md')!.group, position: 'left' })
    })
    const saved = api.toJSON()
    await act(async () => {
      api.clear()
      api.fromJSON(saved)
      useActivityPanelStore.getState().setShowPanel(true)
    })
    expect(api.groups).toHaveLength(2)
    expectMacControls(view, 'file:CLAUDE.md')
  })

  it('keeps the empty-panel entry and hides activity controls while the macOS sidebar is open', async () => {
    const view = render(<ActivityPanel getMaxWidth={() => 1000} transitionMs={0} />)
    expect(view.getAllByRole('button', { name: /toggle sidebar/i })).toHaveLength(1)
    await act(async () => {
      getDockApi()!.layout(1000, 600)
      openNewFileTab('README.md')
      openNewFileTab('CLAUDE.md')
      splitActivityTab('file:CLAUDE.md', 'right')
      useAppStore.setState({ showSidebar: true })
    })
    expect(view.queryByRole('button', { name: /toggle sidebar/i })).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-traffic-light-padding]')).not.toBeInTheDocument()
    await act(async () => { useAppStore.setState({ showSidebar: false }) })
    expectMacControls(view, 'file:README.md')
  })

  it('omits traffic-light spacing in macOS fullscreen without duplicating the controls', async () => {
    Object.assign(window.app, { getFullscreen: async () => true })
    const view = await renderSplit()
    expect(view.getAllByRole('button', { name: /toggle sidebar/i })).toHaveLength(1)
    expect(view.container.querySelectorAll('.lucide-panel-right-open')).toHaveLength(1)
    expect(view.container.querySelector('[data-traffic-light-padding]')).not.toBeInTheDocument()
  })

  it('keeps one control entry when an empty group occupies the top-left corner', async () => {
    const view = await renderSplit()
    const api = getDockApi()!
    await act(async () => {
      api.addGroup({ referenceGroup: api.getPanel('file:README.md')!.group, direction: 'left' })
    })
    expect(api.groups).toHaveLength(3)
    expect(view.getAllByRole('button', { name: /toggle sidebar/i })).toHaveLength(1)
    expect(view.container.querySelectorAll('[data-traffic-light-padding]')).toHaveLength(1)
    const empty = api.groups.find((group) => group.panels.length === 0)!
    expect(within(empty.element).getByRole('button', { name: /toggle sidebar/i })).toBeInTheDocument()
    await act(async () => {
      api.addPanel({ id: 'file:EMPTY.md', component: 'file-preview', params: { filePath: 'EMPTY.md' }, position: { referenceGroup: empty } })
    })
    expectMacControls(view, 'file:EMPTY.md')
  })

  it.each(['left', 'right'] as const)('keeps Windows controls only in the title bar with the panel on the %s', async (side) => {
    Object.assign(window.app, { platform: 'win32' })
    useActivityPanelStore.setState({ side })
    const view = render(<><WindowsTitleBar showLayoutControls /><ActivityPanel getMaxWidth={() => 1000} transitionMs={0} /></>)
    await act(async () => {
      getDockApi()!.layout(1000, 600)
      openNewFileTab('README.md')
      openNewFileTab('CLAUDE.md')
      splitActivityTab('file:CLAUDE.md', 'right')
    })
    const titlebar = view.container.querySelector<HTMLElement>('[data-windows-titlebar]')!
    const activity = view.container.querySelector<HTMLElement>('[data-activity-outer]')!
    const expectTitlebarOnly = () => {
      expect(view.getAllByRole('button', { name: /toggle sidebar/i })).toHaveLength(1)
      expect(within(titlebar).getByRole('button', { name: /toggle sidebar/i })).toBeInTheDocument()
      expect(within(activity).queryByRole('button', { name: /toggle sidebar/i })).not.toBeInTheDocument()
      expect(view.container.querySelector('[data-traffic-light-padding]')).not.toBeInTheDocument()
    }
    expectTitlebarOnly()
    await act(async () => { useAppStore.setState({ showSidebar: true }) })
    expectTitlebarOnly()
    await act(async () => { getDockApi()!.getPanel('file:CLAUDE.md')!.api.maximize() })
    expectTitlebarOnly()
    await act(async () => { getDockApi()!.getPanel('file:CLAUDE.md')!.api.exitMaximized() })
    expectTitlebarOnly()
  })
})
