/** @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutControlCaller } from '@superone/shared/layout-control'
import { ActivityPanel } from '@/components/activity/ActivityPanel'
import { getDockApi, openNewFileTab } from '@/components/activity/activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { layoutAct, layoutSnapshot } from './layout-control'

/** layout_act tab moves and group geometry against a real dockview, 1000×600. */

const PROJECT = '/work/app'
const agent: LayoutControlCaller = { sessionId: 'A', opener: { kind: 'agent' }, root: PROJECT }

beforeEach(async () => {
  Object.assign(window.app, { platform: 'darwin', getFullscreen: async () => false })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  ;(window as unknown as { terminal: unknown }).terminal = { list: vi.fn(async () => []) }
  useAppStore.setState({ view: 'main', showSidebar: false, currentFolder: null })
  useActivityPanelStore.setState({ showPanel: true, side: 'left', maximized: false, maximizedGroupId: null, chatFloating: false })
  useChatStore.setState({
    activeProject: PROJECT,
    projectSessions: { [PROJECT]: { _activeSessionId: 'A', _sessions: {} } } as never,
  })
  useActivityViewStateStore.getState()._resetForTest()
  useActivityViewStateStore.setState({ _currentSessionId: 'A' })
  render(<ActivityPanel getMaxWidth={() => 1000} transitionMs={0} />)
  await act(async () => {
    getDockApi()!.layout(1000, 600)
    openNewFileTab('a.ts')
    openNewFileTab('b.ts')
    openNewFileTab('c.ts')
  })
})

afterEach(cleanup)

const tabsByGroup = () => {
  const groups: string[][] = []
  for (const { tab, group } of layoutSnapshot(agent).tabs) (groups[group] ??= []).push(tab)
  return groups
}

describe('layout_act move_tab and resize_group', () => {
  it('reports each group with its box, so the agent can tell top/bottom from side by side', async () => {
    await act(async () => { await layoutAct(agent, { action: 'move_tab', tab: 'file:c.ts', direction: 'down' }) })

    expect(layoutSnapshot(agent).groups).toEqual([
      { group: 0, x: 0, y: 0, width: 1000, height: 300 },
      { group: 1, x: 0, y: 300, width: 1000, height: 300 },
    ])
    expect(tabsByGroup()).toEqual([['file:a.ts', 'file:b.ts'], ['file:c.ts']])
  })

  it('splits to the left or above, beside another group', async () => {
    await act(async () => { await layoutAct(agent, { action: 'move_tab', tab: 'file:c.ts', direction: 'left' }) })
    expect(tabsByGroup()).toEqual([['file:c.ts'], ['file:a.ts', 'file:b.ts']])

    await act(async () => { await layoutAct(agent, { action: 'move_tab', tab: 'file:b.ts', group: 0, direction: 'up' }) })
    const { groups } = layoutSnapshot(agent)
    expect(groups).toHaveLength(3)
    // b sits above c, both left of a.
    expect(tabsByGroup()).toEqual([['file:b.ts'], ['file:c.ts'], ['file:a.ts']])
    expect(groups[0]).toMatchObject({ x: 0, y: 0 })
    expect(groups[1]).toMatchObject({ x: 0, y: groups[0].height })
    expect(groups[2]).toMatchObject({ x: groups[0].width, y: 0 })
  })

  it('merges a tab back into another group, undoing a split', async () => {
    await act(async () => { await layoutAct(agent, { action: 'move_tab', tab: 'file:c.ts', direction: 'right' }) })
    expect(layoutSnapshot(agent).groups).toHaveLength(2)

    await act(async () => { await layoutAct(agent, { action: 'move_tab', tab: 'file:c.ts', group: 0, direction: 'into', index: 0 }) })

    expect(layoutSnapshot(agent).groups).toHaveLength(1)
    expect(tabsByGroup()).toEqual([['file:c.ts', 'file:a.ts', 'file:b.ts']])
  })

  it('reorders tabs inside their group', async () => {
    await act(async () => { await layoutAct(agent, { action: 'move_tab', tab: 'file:c.ts', direction: 'into', index: 0 }) })
    expect(tabsByGroup()).toEqual([['file:c.ts', 'file:a.ts', 'file:b.ts']])
  })

  it('resizes a group and reports the size it got', async () => {
    await act(async () => { await layoutAct(agent, { action: 'move_tab', tab: 'file:c.ts', direction: 'right' }) })

    let result: Awaited<ReturnType<typeof layoutAct>> | undefined
    await act(async () => { result = await layoutAct(agent, { action: 'resize_group', group: 0, width: 700 }) })

    expect(result).toMatchObject({ status: 'applied', width: 700, height: 600 })
    expect(layoutSnapshot(agent).groups.map((group) => group.width)).toEqual([700, 300])
  })

  it('names the snapshot for an unknown group', async () => {
    await expect(layoutAct(agent, { action: 'move_tab', tab: 'file:c.ts', group: 5, direction: 'into' }))
      .rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('layout_snapshot') })
    await expect(layoutAct(agent, { action: 'resize_group', width: 300 })).rejects.toMatchObject({ code: 'invalid' })
  })
})
