/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

const { showMiniAppTargetInPanel } = vi.hoisted(() => ({ showMiniAppTargetInPanel: vi.fn() }))
vi.mock('./miniapp-automation-targets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./miniapp-automation-targets')>()),
  showMiniAppTargetInPanel,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.miniAppPreview.label': 'Mini app picture in picture',
      'chat.miniAppPreview.hide': 'Hide mini app preview',
      'chat.miniAppPreview.open': 'Open in Activity panel',
    } as Record<string, string>)[key] ?? key,
  }),
}))

import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { useMiniAppPipStore } from '@/stores/miniapp-pip'
import { useToolUiPreviewStore } from '@/stores/miniapp-tool-preview'
import { MiniAppPictureInPicture } from './MiniAppPictureInPicture'

const APP: MiniAppEntry = { id: 'tasks', installDir: '/apps/tasks', distDir: '/src/tasks/dist', manifest: { appId: 'tasks', name: 'Tasks', main: 'node.js' } }

beforeEach(() => {
  showMiniAppTargetInPanel.mockReset()
  document.body.innerHTML = ''
  const boundary = document.createElement('div')
  boundary.setAttribute('data-chat-root', '')
  boundary.getBoundingClientRect = () => ({
    left: 100, top: 50, width: 1000, height: 700,
    right: 1100, bottom: 750, x: 100, y: 50, toJSON: () => ({}),
  })
  document.body.appendChild(boundary)
  useChatStore.setState({
    activeProject: '/alpha',
    projectSessions: { '/alpha': { _activeSessionId: 'session-a', _sessions: { 'session-a': {} } } },
  } as unknown as Parameters<typeof useChatStore.setState>[0])
  useMiniAppStore.setState({
    openApps: { 'tasks:alpha': { instanceKey: 'tasks:alpha', entry: APP, projectDir: '/alpha', projectId: 'alpha', holderSessions: new Set() } },
    slots: { 'tasks:alpha': { mode: 'panel', left: 700, top: 40, width: 400, height: 800 } },
  })
  useToolUiPreviewStore.setState({ previews: {} })
  useMiniAppPipStore.setState({ pipSlots: {}, hidden: null })
  useActivityPanelStore.setState({ showPanel: false, panelWidth: 560, bounds: { left: 0, top: 0, width: 560, height: 834 } })
  useAgentViewfinderStore.setState({ activeBySession: {} })
})

function drive(targetId: string, sessionId = 'session-a') {
  act(() => useAgentViewfinderStore.getState().activate(sessionId, 'miniapp', targetId))
}

describe('mini-app picture in picture', () => {
  it('uses the full panel viewport even when the dock slot is narrow', async () => {
    drive('miniapp:tasks')
    render(<MiniAppPictureInPicture />)

    const pip = await screen.findByLabelText('Mini app picture in picture')
    expect(pip).toHaveStyle({ width: '180px' })
    expect(parseFloat(pip.style.height)).toBeCloseTo(180 / (560 / 800), 2)
    expect(parseFloat(pip.style.left) + 180).toBeCloseTo(1100 - 12, 0)

    act(() => useMiniAppStore.getState().updateSlot('tasks:alpha', 'panel', {
      left: 700, top: 40, width: 720, height: 400,
    } as DOMRectReadOnly))
    expect(parseFloat(pip.style.height)).toBeCloseTo(180 / (560 / 800), 2)
  })

  it('frames a view whose dock tab never laid out, at the panel width', async () => {
    useMiniAppStore.setState({ slots: {} })
    useActivityPanelStore.setState({ panelWidth: 560, bounds: null })
    drive('miniapp:tasks')
    render(<MiniAppPictureInPicture />)

    const pip = await screen.findByLabelText('Mini app picture in picture')
    expect(pip).toHaveStyle({ width: '180px' })
    expect(parseFloat(pip.style.height)).toBeCloseTo(180 / (560 / 720), 2)

    act(() => useBrowserStore.getState().setEmulation('miniapp:tasks@/alpha', { width: 390, height: 844 }))
    expect(parseFloat(pip.style.height)).toBeCloseTo(180 / (390 / 844), 2)
  })

  it('stays away while the Activity panel shows the view', () => {
    useActivityPanelStore.setState({ showPanel: true })
    drive('miniapp:tasks')
    render(<MiniAppPictureInPicture />)

    expect(screen.queryByLabelText('Mini app picture in picture')).toBeNull()
  })

  it('never frames a chat tool UI or another session’s target', () => {
    drive('miniapp:tasks:tool:toolu_1')
    drive('miniapp:tasks', 'session-b')
    render(<MiniAppPictureInPicture />)

    expect(screen.queryByLabelText('Mini app picture in picture')).toBeNull()
  })

  it('opens the view in the Activity panel on click and hides until restored', async () => {
    drive('miniapp:tasks')
    render(<MiniAppPictureInPicture />)
    const handle = await screen.findByRole('button', { name: 'Open in Activity panel' })

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(window)
    expect(showMiniAppTargetInPanel).toHaveBeenCalledWith('miniapp:tasks', '/alpha')

    fireEvent.click(screen.getByRole('button', { name: 'Hide mini app preview' }))
    await waitFor(() => expect(screen.queryByLabelText('Mini app picture in picture')).toBeNull())
    expect(useMiniAppPipStore.getState().hidden).toEqual({ sessionId: 'session-a', targetId: 'miniapp:tasks' })
  })
})
