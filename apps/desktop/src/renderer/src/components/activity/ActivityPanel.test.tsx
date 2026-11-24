/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useChatStore } from '@/stores/chat'
import { WindowsTitleBar } from '@/components/WindowsTitleBar'
import { ActivityPanel } from './ActivityPanel'
import { ChatFloatDropOverlay } from './ChatFloatDropOverlay'
import { getDockApi, openNewFileTab, splitActivityTab, toggleMaximizedActivityGroup } from './activity-panel-api'

beforeEach(() => {
  Object.assign(window.app, { platform: 'darwin', getFullscreen: async () => false })
  useAppStore.setState({ showSidebar: false, currentFolder: null })
  useActivityPanelStore.setState({ showPanel: true, side: 'left', maximized: false, maximizedGroupId: null, chatFloating: false })
})

afterEach(cleanup)

describe('activity panel resize', () => {
  it.each(['left', 'right'] as const)('shows 2/3 drop overlay and collapses chat on release with the panel on the %s', (side) => {
    useActivityPanelStore.setState({ side, panelWidth: 440, userResized: false, floatDropPreview: null })
    const wasOpen = useChatStore.getState().isOpen
    useChatStore.setState({ isOpen: true })

    try {
      const { container } = render(
        <>
          <ActivityPanel getMaxWidth={() => 500} floatChatOnResizeOverflow transitionMs={0} />
          <div data-main-area="">
            <ChatFloatDropOverlay />
          </div>
        </>,
      )
      const handle = container.querySelector('[data-activity-resize-handle]')!
      const direction = side === 'left' ? 1 : -1
      const startX = 500
      const drag = (distance: number) => fireEvent.mouseMove(document, { clientX: startX + distance * direction })

      fireEvent.mouseDown(handle, { clientX: startX })
      drag(60)
      expect(container.querySelector('[data-activity-outer]')).toHaveStyle({ width: '500px' })
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toBeNull()

      drag(68)
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toHaveAttribute('data-active', 'false')
      expect(useActivityPanelStore.getState().chatFloating).toBe(false)
      expect(useChatStore.getState().isOpen).toBe(true)

      drag(180)
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toHaveAttribute('data-active', 'true')
      expect(useActivityPanelStore.getState().chatFloating).toBe(false)

      drag(68)
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toHaveAttribute('data-active', 'false')

      drag(180)
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toHaveAttribute('data-active', 'true')
      fireEvent.mouseUp(document, { clientX: startX + 180 * direction })
      expect(useActivityPanelStore.getState()).toMatchObject({ chatFloating: true, maximized: false, panelWidth: 500, userResized: true, floatDropPreview: null })
      expect(useChatStore.getState().isOpen).toBe(false)
      expect(handle).not.toBeInTheDocument()
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toBeNull()
      expect(document.body.style.cursor).toBe('')
    } finally {
      fireEvent.blur(window)
      useChatStore.setState({ isOpen: wasOpen })
    }
  })

  it('cancels float when released outside the active drop zone', () => {
    useActivityPanelStore.setState({ side: 'left', panelWidth: 440, userResized: false, floatDropPreview: null })
    const wasOpen = useChatStore.getState().isOpen
    useChatStore.setState({ isOpen: true })

    try {
      const { container } = render(
        <>
          <ActivityPanel getMaxWidth={() => 500} floatChatOnResizeOverflow transitionMs={0} />
          <div data-main-area="">
            <ChatFloatDropOverlay />
          </div>
        </>,
      )
      const handle = container.querySelector('[data-activity-resize-handle]')!
      const startX = 500

      fireEvent.mouseDown(handle, { clientX: startX })
      fireEvent.mouseMove(document, { clientX: startX + 180 })
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toHaveAttribute('data-active', 'true')

      fireEvent.mouseMove(document, { clientX: startX + 68 })
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toHaveAttribute('data-active', 'false')

      fireEvent.mouseUp(document, { clientX: startX + 68 })
      expect(useActivityPanelStore.getState()).toMatchObject({ chatFloating: false, floatDropPreview: null })
      expect(useChatStore.getState().isOpen).toBe(true)
      expect(container.querySelector('[data-chat-float-drop-overlay]')).toBeNull()
    } finally {
      fireEvent.blur(window)
      useChatStore.setState({ isOpen: wasOpen })
    }
  })

  it('flex-fills without width transition while chat width is locked during sidebar toggle', () => {
    useActivityPanelStore.setState({ side: 'left', panelWidth: 500, lockedChatWidth: 420 })
    const { container } = render(<ActivityPanel getMaxWidth={() => 900} />)
    const outer = container.querySelector<HTMLElement>('[data-activity-outer]')!
    const inner = container.querySelector<HTMLElement>('[data-activity-inner]')!

    expect(outer).toHaveClass('flex-1')
    expect(outer).not.toHaveClass('transition-[width]')
    expect(outer.style.width).toBe('')
    expect(outer.style.minWidth).toBe('400px')
    expect(inner.style.width).toBe('100%')
    expect(container.querySelector('[data-activity-resize-handle]')).toBeNull()

    act(() => {
      useActivityPanelStore.setState({ lockedChatWidth: null })
    })

    expect(outer).toHaveClass('shrink-0', 'transition-[width]')
    expect(outer.style.width).toBe('500px')
    expect(inner.style.width).toBe('500px')
    expect(container.querySelector('[data-activity-resize-handle]')).not.toBeNull()
  })
})

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
  expect(view.queryByRole('button', { name: /toggle sidebar/i })).not.toBeInTheDocument()
  const wrappers = view.container.querySelectorAll('[data-activity-controls-spacer]')
  expect(wrappers).toHaveLength(1)
  expect(wrappers[0]).toHaveClass('pl-[18px]')
  const trafficSpacers = view.container.querySelectorAll('[data-traffic-light-padding]')
  expect(trafficSpacers).toHaveLength(1)
  expect(trafficSpacers[0]).toHaveClass('w-[61px]')
  const controlSpacers = view.container.querySelectorAll('[data-layout-controls-spacer]')
  expect(controlSpacers).toHaveLength(1)
  expect(controlSpacers[0]).toHaveStyle({ width: maximized ? '32px' : '58px' })
  for (const group of api.groups) {
    const owned = group.element.querySelectorAll('[data-activity-controls-spacer]')
    expect(owned).toHaveLength(group === api.getPanel(owner)!.group ? 1 : 0)
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

  it('hides the bottom split view when maximizing the top group in a vertical split', async () => {
    const view = await renderSplit('below')
    const api = getDockApi()!
    const topGroup = api.getPanel('file:README.md')!.group
    const bottomGroup = api.getPanel('file:CLAUDE.md')!.group

    await act(async () => { api.getPanel('file:README.md')!.api.maximize() })
    expect(topGroup.element.closest('.dv-view')).toHaveClass('visible')
    expect(bottomGroup.element.closest('.dv-view')).not.toHaveClass('visible')

    await act(async () => { api.getPanel('file:README.md')!.api.exitMaximized() })
    expect(bottomGroup.element.closest('.dv-view')).toHaveClass('visible')
  })

  it.each(['file:README.md', 'file:CLAUDE.md'] as const)('preserves horizontal split ratio after maximizing %s and exiting', async (panelId) => {
    useActivityPanelStore.setState({ panelWidth: 500 })
    render(<ActivityPanel getMaxWidth={() => 1000} transitionMs={0} />)
    await act(async () => {
      getDockApi()!.layout(500, 600)
      openNewFileTab('README.md')
      openNewFileTab('CLAUDE.md')
      splitActivityTab('file:CLAUDE.md', 'right')
      getDockApi()!.getPanel('file:README.md')!.group.api.setSize({ width: 150 })
    })
    const leftGroup = getDockApi()!.getPanel('file:README.md')!.group
    const rightGroup = getDockApi()!.getPanel('file:CLAUDE.md')!.group
    expect(leftGroup.api.width).toBe(150)
    expect(rightGroup.api.width).toBe(350)

    await act(async () => {
      toggleMaximizedActivityGroup(panelId)
      getDockApi()!.layout(1400, 600)
    })

    await act(async () => {
      toggleMaximizedActivityGroup(panelId)
      getDockApi()!.layout(500, 600)
    })

    expect(leftGroup.api.width).toBe(150)
    expect(rightGroup.api.width).toBe(350)
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

  it('omits activity avoidance when empty or while the macOS sidebar is open', async () => {
    const view = render(<ActivityPanel getMaxWidth={() => 1000} transitionMs={0} />)
    expect(view.container.querySelector('[data-activity-controls-spacer]')).not.toBeInTheDocument()
    await act(async () => {
      getDockApi()!.layout(1000, 600)
      openNewFileTab('README.md')
      openNewFileTab('CLAUDE.md')
      splitActivityTab('file:CLAUDE.md', 'right')
      useAppStore.setState({ showSidebar: true })
    })
    expect(view.container.querySelector('[data-activity-controls-spacer]')).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-traffic-light-padding]')).not.toBeInTheDocument()
    await act(async () => { useAppStore.setState({ showSidebar: false }) })
    expectMacControls(view, 'file:README.md')
  })

  it('omits traffic-light spacing in macOS fullscreen while keeping control avoidance', async () => {
    Object.assign(window.app, { getFullscreen: async () => true })
    const view = await renderSplit()
    expect(view.container.querySelectorAll('[data-activity-controls-spacer]')).toHaveLength(1)
    expect(view.container.querySelector('[data-activity-controls-spacer]')).toHaveClass('pl-2')
    expect(view.container.querySelector('[data-layout-controls-spacer]')).toHaveStyle({ width: '58px' })
    expect(view.container.querySelector('[data-traffic-light-padding]')).not.toBeInTheDocument()
  })

  it('transfers avoidance cleanly when a top-left empty group gains a tab', async () => {
    const view = await renderSplit()
    const api = getDockApi()!
    await act(async () => {
      api.addGroup({ referenceGroup: api.getPanel('file:README.md')!.group, direction: 'left' })
    })
    expect(api.groups).toHaveLength(3)
    expect(view.container.querySelector('[data-activity-controls-spacer]')).not.toBeInTheDocument()
    const empty = api.groups.find((group) => group.panels.length === 0)!
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

  it('drags tabs horizontally without collapsing and swaps past midpoint threshold', async () => {
    render(<ActivityPanel getMaxWidth={() => 1000} transitionMs={0} />)
    await act(async () => {
      getDockApi()!.layout(1000, 600)
      openNewFileTab('README.md')
      openNewFileTab('CLAUDE.md')
    })

    const api = getDockApi()!
    const group = api.getPanel('file:README.md')!.group
    const strip = group.element.querySelector<HTMLElement>('.dv-tabs-container')!
    const tabEls = Array.from(strip.querySelectorAll<HTMLElement>('.dv-tab'))
    expect(tabEls).toHaveLength(2)
    expect(tabEls[0].draggable).toBe(false)

    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 200, top: 0, bottom: 36, width: 200, height: 36, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(tabEls[0], 'getBoundingClientRect').mockReturnValue({ left: 0, right: 100, top: 0, bottom: 36, width: 100, height: 36, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(tabEls[1], 'getBoundingClientRect').mockReturnValue({ left: 100, right: 200, top: 0, bottom: 36, width: 100, height: 36, x: 100, y: 0, toJSON: () => ({}) })

    await act(async () => {
      fireEvent.pointerDown(tabEls[0], { button: 0, clientX: 50, clientY: 18, pointerId: 1 })
      fireEvent.pointerMove(window, { clientX: 80, clientY: 18, pointerId: 1 })
    })
    expect(tabEls[0]).toHaveAttribute('data-chrome-dragging', 'true')
    expect(tabEls[0]).not.toHaveClass('dv-tab--dragging')
    expect(tabEls[0].style.transform).toBe('translateX(30px)')
    expect(tabEls[1].style.transform).toBe('')

    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 110, clientY: 18, pointerId: 1 })
    })
    expect(tabEls[1].style.transform).toBe('translateX(-100px)')

    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 110, clientY: 18, pointerId: 1 })
    })
    expect(group.panels.map((p) => p.id)).toEqual(['file:CLAUDE.md', 'file:README.md'])
  })
})
