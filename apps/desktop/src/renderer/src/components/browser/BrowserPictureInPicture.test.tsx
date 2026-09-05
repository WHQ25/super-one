/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { setDockApi } from '@/components/activity/activity-panel-api'

const chatState = {
  activeProject: '/project',
  projectSessions: { '/project': { _activeSessionId: 'session-a' } },
}

const turnCompletion = vi.hoisted(() => ({ callback: null as null | (() => void) }))

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}))

vi.mock('@/components/mosaic/mosaic-store', () => ({
  useMosaicStore: (selector: (state: { mode: 'single' }) => unknown) => selector({ mode: 'single' }),
}))

vi.mock('@/hooks/useOnTurnCompleted', () => ({
  useOnTurnCompleted: (callback: () => void) => { turnCompletion.callback = callback },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.browser.previewLabel': 'Browser picture in picture',
      'chat.browser.previewExpandedLabel': 'Expanded browser preview',
      'chat.browser.previewHide': 'Hide browser preview',
      'chat.browser.previewExpand': 'Expand browser preview',
      'chat.browser.previewShrink': 'Shrink browser preview',
    } as Record<string, string>)[key] ?? key,
  }),
}))

vi.mock('./BrowserView', () => ({
  BrowserView: ({ browserId, mode, interactive, showChrome, trackBoundsContinuously }: {
    browserId: string
    mode: string
    interactive?: boolean
    showChrome?: boolean
    trackBoundsContinuously?: boolean
  }) => (
    <div
      data-testid="pip-browser-view"
      data-browser-id={browserId}
      data-mode={mode}
      data-interactive={String(interactive)}
      data-show-chrome={String(showChrome)}
      data-track-bounds-continuously={String(trackBoundsContinuously)}
    />
  ),
}))

const { BrowserPictureInPicture } = await import('./BrowserPictureInPicture')

beforeEach(() => {
  document.body.innerHTML = ''
  const boundary = document.createElement('div')
  boundary.setAttribute('data-chat-root', '')
  boundary.getBoundingClientRect = () => ({
    left: 100,
    top: 50,
    width: 1000,
    height: 700,
    right: 1100,
    bottom: 750,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  })
  document.body.appendChild(boundary)
  useActivityPanelStore.setState({ showPanel: false })
  useAgentViewfinderStore.setState({ activeBySession: {} })
  useBrowserStore.setState({
    tabs: {},
    slots: {},
    pipSlots: {},
    overlaySlots: {},
    automationCounts: {},
    activeAutomationId: null,
    pendingPreviewBrowserId: null,
    automationPreviewBrowserId: null,
    automationPreviewReady: {},
    expandedBrowserId: null,
    pinnedPipBrowserId: null,
    hiddenPreviewBrowserId: null,
  })
  setDockApi(null)
  turnCompletion.callback = null
})

function startReadyAutomation(): void {
  useBrowserStore.getState().ensure('browser-a', 'https://example.com', 'session-a')
  useBrowserStore.getState().beginAutomation('browser-a')
  useBrowserStore.getState().markAutomationPreviewReady('browser-a')
  useAgentViewfinderStore.getState().activate('session-a', 'browser', 'browser-a')
}

describe('browser picture in picture', () => {
  it('shows the current session browser at the chat top-right and returns it to Activity Panel', async () => {
    const setActive = vi.fn()
    setDockApi({ panels: [{ id: 'browser-a', api: { setActive } }] } as never)
    act(() => {
      startReadyAutomation()
    })
    render(<BrowserPictureInPicture />)

    const pip = await screen.findByLabelText('Browser picture in picture')
    expect(pip).toHaveStyle({ left: '888px', top: '62px', width: '200px', height: '125px' })
    expect(screen.getByTestId('pip-browser-view')).toHaveAttribute('data-mode', 'pip')
    expect(screen.getByTestId('pip-browser-view')).toHaveAttribute('data-interactive', 'false')
    expect(screen.getByTestId('pip-browser-view')).toHaveAttribute('data-show-chrome', 'false')

    act(() => useActivityPanelStore.getState().setShowPanel(true))
    expect(setActive).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByLabelText('Browser picture in picture')).not.toBeInTheDocument())
  })

  it('can hide the read-only picture-in-picture preview', async () => {
    act(() => {
      startReadyAutomation()
    })
    render(<BrowserPictureInPicture />)

    fireEvent.click(await screen.findByRole('button', { name: 'Hide browser preview' }))
    await waitFor(() => expect(screen.queryByLabelText('Browser picture in picture')).not.toBeInTheDocument())
    expect(useBrowserStore.getState().hiddenPreviewBrowserId).toBe('browser-a')
  })

  it('opens an interactive independent overlay that can shrink or hide', async () => {
    act(() => {
      startReadyAutomation()
    })
    render(<BrowserPictureInPicture />)

    const pipHandle = (await screen.findByLabelText('Browser picture in picture'))
      .querySelector('[data-browser-pip-drag-handle]') as HTMLElement
    fireEvent.pointerDown(pipHandle, { button: 0, clientX: 700, clientY: 70 })
    fireEvent.pointerUp(window, { clientX: 700, clientY: 70 })
    const overlay = await screen.findByRole('dialog', { name: 'Expanded browser preview' })
    expect(overlay).toHaveClass('rounded-none')
    expect(within(overlay).getByTestId('pip-browser-view')).toHaveAttribute('data-mode', 'overlay')
    expect(within(overlay).getByTestId('pip-browser-view')).toHaveAttribute('data-interactive', 'true')
    expect(within(overlay).getByTestId('pip-browser-view')).toHaveAttribute('data-show-chrome', 'false')
    expect(overlay.querySelector('[data-browser-preview-actions]')).toHaveClass('absolute')

    fireEvent.click(screen.getByRole('button', { name: 'Shrink browser preview' }))
    const pip = await screen.findByLabelText('Browser picture in picture')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Expanded browser preview' })).not.toBeInTheDocument())
    expect(within(pip).getByTestId('pip-browser-view')).toHaveAttribute('data-mode', 'pip')

    const reopenedHandle = pip.querySelector('[data-browser-pip-drag-handle]') as HTMLElement
    fireEvent.pointerDown(reopenedHandle, { button: 0, clientX: 700, clientY: 70 })
    fireEvent.pointerUp(window, { clientX: 700, clientY: 70 })
    const reopenedOverlay = await screen.findByRole('dialog', { name: 'Expanded browser preview' })
    fireEvent.click(within(reopenedOverlay).getByRole('button', { name: 'Hide browser preview' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Expanded browser preview' })).not.toBeInTheDocument())
  })

  it('shows only Hide in the minimized action bar and does not expand after a drag', async () => {
    act(() => {
      startReadyAutomation()
    })
    render(<BrowserPictureInPicture />)

    const pip = await screen.findByLabelText('Browser picture in picture')
    const actions = pip.querySelector('[data-browser-pip-actions]') as HTMLElement
    expect(within(actions).getAllByRole('button')).toHaveLength(1)
    expect(within(actions).getByRole('button', { name: 'Hide browser preview' })).toBeInTheDocument()

    const dragHandle = pip.querySelector('[data-browser-pip-drag-handle]') as HTMLElement
    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 700, clientY: 70 })
    fireEvent.pointerMove(window, { clientX: 720, clientY: 90 })
    fireEvent.pointerUp(window, { clientX: 720, clientY: 90 })
    expect(screen.queryByRole('dialog', { name: 'Expanded browser preview' })).not.toBeInTheDocument()
  })

  it('keeps drag and resize results inside the chat bounds and under the 80% width cap', async () => {
    act(() => {
      startReadyAutomation()
    })
    render(<BrowserPictureInPicture />)

    const pip = await screen.findByLabelText('Browser picture in picture')
    const dragHandle = pip.querySelector('[data-browser-pip-drag-handle]') as HTMLElement
    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 700, clientY: 70 })
    expect(screen.getByTestId('pip-browser-view')).toHaveAttribute('data-track-bounds-continuously', 'true')
    fireEvent.pointerMove(window, { clientX: -500, clientY: 1000 })
    fireEvent.pointerUp(window)
    expect(screen.getByTestId('pip-browser-view')).toHaveAttribute('data-track-bounds-continuously', 'false')
    expect(pip).toHaveStyle({ left: '112px', top: '613px' })

    const resize = pip.querySelector('[data-browser-pip-resize="se"]') as HTMLElement
    fireEvent.pointerDown(resize, { button: 0, clientX: 592, clientY: 738 })
    fireEvent.pointerMove(window, { clientX: 2000, clientY: 2000 })
    fireEvent.pointerUp(window)
    expect(pip).toHaveStyle({ width: '800px', height: '500px' })
  })

  it('matches the open tab viewport instead of a fixed 3:2 frame', async () => {
    act(() => {
      startReadyAutomation()
      useBrowserStore.getState().updateSlot('browser-a', 'panel', {
        left: 120,
        top: 44,
        width: 1280,
        height: 720,
      } as DOMRectReadOnly)
    })
    render(<BrowserPictureInPicture />)

    const pip = await screen.findByLabelText('Browser picture in picture')
    expect(pip).toHaveStyle({ width: '200px', height: '112.5px' })

    act(() => {
      useBrowserStore.getState().updateSlot('browser-a', 'panel', {
        left: 120,
        top: 44,
        width: 560,
        height: 800,
      } as DOMRectReadOnly)
    })
    expect(pip).toHaveStyle({ width: '200px' })
    expect(parseFloat(pip.style.height)).toBeCloseTo(200 / (560 / 800), 2)
  })

  it('waits for page readiness, stays between tool calls, and closes when the turn ends', async () => {
    act(() => {
      useBrowserStore.getState().ensure('browser-a', 'https://example.com', 'session-a')
      useBrowserStore.getState().patch('browser-a', { loading: true })
      useBrowserStore.getState().beginAutomation('browser-a')
      useAgentViewfinderStore.getState().activate('session-a', 'browser', 'browser-a')
    })
    render(<BrowserPictureInPicture />)
    expect(screen.queryByLabelText('Browser picture in picture')).not.toBeInTheDocument()

    act(() => {
      useBrowserStore.getState().patch('browser-a', { loading: false })
      useBrowserStore.getState().markAutomationPreviewReady('browser-a')
      useBrowserStore.getState().endAutomation('browser-a')
    })
    const pip = await screen.findByLabelText('Browser picture in picture')
    expect(pip).toBeInTheDocument()

    act(() => turnCompletion.callback?.())
    await waitFor(() => expect(screen.queryByLabelText('Browser picture in picture')).not.toBeInTheDocument())
  })

  it('stays on the last operated browser while the next tool call is still unresolved', async () => {
    act(() => startReadyAutomation())
    render(<BrowserPictureInPicture />)
    expect(await screen.findByLabelText('Browser picture in picture')).toBeInTheDocument()

    // The tool event names the surface before the runtime resolves the tab id, and
    // the next call re-enters automation on a page that is loading again.
    act(() => {
      useAgentViewfinderStore.getState().activate('session-a', 'browser')
      useBrowserStore.getState().patch('browser-a', { loading: true })
      useBrowserStore.getState().beginAutomation('browser-a')
    })

    // Outlast the 160ms exit animation: a blink would have unmounted it by now.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)) })
    expect(screen.getByLabelText('Browser picture in picture')).toBeInTheDocument()
    expect(screen.getByTestId('pip-browser-view')).toHaveAttribute('data-browser-id', 'browser-a')
  })

  it('shows nothing while the first operated browser target is still unresolved', () => {
    act(() => {
      startReadyAutomation()
      useBrowserStore.getState().expandPreview('browser-a')
      useAgentViewfinderStore.getState().activate('session-a', 'device')
      useAgentViewfinderStore.getState().activate('session-a', 'browser')
    })

    render(<BrowserPictureInPicture />)

    expect(screen.queryByLabelText('Browser picture in picture')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Expanded browser preview' })).not.toBeInTheDocument()
  })

  it('reveals preview actions only on hover or keyboard focus', async () => {
    act(() => startReadyAutomation())
    render(<BrowserPictureInPicture />)

    const pip = await screen.findByLabelText('Browser picture in picture')
    expect(pip).toHaveClass('group/browser-pip')
    const actions = pip.querySelector('[data-browser-pip-actions]') as HTMLElement
    expect(actions).toHaveClass('opacity-0')
    expect(actions.className).toContain('group-hover/browser-pip:opacity-100')
    expect(actions.className).toContain('group-focus-within/browser-pip:opacity-100')
  })
})
