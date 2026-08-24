/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat'
import { useAgentViewfinderStore } from '@/stores/agent-viewfinder'
import { useComputerViewfinderStore } from '@/stores/computer-viewfinder'
import { ComputerUsePictureInPicture } from './ComputerUsePictureInPicture'

const focusComputerUseViewfinder = vi.fn()
const hideComputerUseViewfinder = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'chat.computerUsePreview.label': 'Computer Use picture in picture',
      'chat.computerUsePreview.hide': 'Hide Computer Use preview',
      'chat.computerUsePreview.focus': 'Focus controlled window',
    } as Record<string, string>)[key] ?? key,
  }),
}))

beforeEach(() => {
  focusComputerUseViewfinder.mockReset()
  hideComputerUseViewfinder.mockReset()
  hideComputerUseViewfinder.mockResolvedValue(true)
  Object.assign(window.app, { focusComputerUseViewfinder, hideComputerUseViewfinder })
  document.body.innerHTML = ''
  const boundary = document.createElement('div')
  boundary.setAttribute('data-chat-root', '')
  boundary.getBoundingClientRect = () => ({
    left: 100, top: 50, width: 1000, height: 700,
    right: 1100, bottom: 750, x: 100, y: 50, toJSON: () => ({}),
  })
  document.body.appendChild(boundary)
  useChatStore.setState({
    activeProject: '/project',
    projectSessions: { '/project': { _activeSessionId: 'session-a' } },
  } as unknown as Parameters<typeof useChatStore.setState>[0])
  useAgentViewfinderStore.setState({ activeBySession: {} })
  useComputerViewfinderStore.getState().reset()
})

describe('Computer Use picture in picture', () => {
  it('renders the native stream at the owning session top-right at 180px wide', async () => {
    act(() => {
      useComputerViewfinderStore.getState().applyClaim({
        sessionId: 'session-a', active: true, windowId: 42,
        sourceWidth: 1200, sourceHeight: 800,
      })
      useComputerViewfinderStore.getState().applyFrame({
        sessionId: 'session-a', windowId: 42, width: 480, height: 320, data: 'jpeg',
      })
      useAgentViewfinderStore.getState().activate('session-a', 'computer', '42')
    })
    render(<ComputerUsePictureInPicture />)

    const pip = await screen.findByLabelText('Computer Use picture in picture')
    expect(pip).toHaveStyle({ left: '908px', top: '62px', width: '180px', height: '120px' })
    expect(pip.querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,jpeg')

    fireEvent.click(screen.getByRole('button', { name: 'Hide Computer Use preview' }))
    await waitFor(() => expect(screen.queryByLabelText('Computer Use picture in picture')).toBeNull())
    expect(hideComputerUseViewfinder).toHaveBeenCalledWith('session-a')
  })

  it('does not leak a target into a different active session', () => {
    act(() => {
      useComputerViewfinderStore.getState().applyClaim({
        sessionId: 'session-b', active: true, windowId: 42,
      })
      useAgentViewfinderStore.getState().activate('session-b', 'computer', '42')
    })
    render(<ComputerUsePictureInPicture />)
    expect(screen.queryByLabelText('Computer Use picture in picture')).toBeNull()
  })

  it('focuses the controlled window on click but keeps dragging as a move gesture', async () => {
    act(() => {
      useComputerViewfinderStore.getState().applyClaim({
        sessionId: 'session-a', active: true, windowId: 42,
        bundleId: 'com.apple.TextEdit', pid: 123,
      })
      useAgentViewfinderStore.getState().activate('session-a', 'computer', '42')
    })
    render(<ComputerUsePictureInPicture />)

    const pip = await screen.findByLabelText('Computer Use picture in picture')
    const handle = pip.querySelector('[data-computer-use-pip-drag-handle]') as HTMLElement
    fireEvent.pointerDown(handle, { button: 0, clientX: 700, clientY: 70 })
    fireEvent.pointerUp(window, { clientX: 700, clientY: 70 })
    await waitFor(() => expect(focusComputerUseViewfinder).toHaveBeenCalledWith('session-a'))

    focusComputerUseViewfinder.mockClear()
    fireEvent.pointerDown(handle, { button: 0, clientX: 700, clientY: 70 })
    fireEvent.pointerMove(window, { clientX: 720, clientY: 90 })
    fireEvent.pointerUp(window, { clientX: 720, clientY: 90 })
    expect(focusComputerUseViewfinder).not.toHaveBeenCalled()
  })
})
