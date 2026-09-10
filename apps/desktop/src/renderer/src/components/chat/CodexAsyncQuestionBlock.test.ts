/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const steer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { CodexAsyncQuestionBlock, formatCodexAsyncQuestionReply } from './CodexAsyncQuestionBlock'

import { SessionScopeProvider, useChatStore } from '@/stores/chat'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'

beforeEach(() => {
  steer.mockReset()
  window.app.codexSteer = steer
  useChatStore.setState({
    remoteSessions: {},
    activeProject: '/project',
    projectSessions: {
      '/project': {
        ...createDefaultProjectState(),
        _activeSessionId: 'session-1',
        _sessions: { 'session-1': { ...createDefaultPerSessionState(), status: 'streaming', sessionProvider: 'codex' } },
      },
    },
  })
})
afterEach(cleanup)

const question = {
  id: 'question-1', type: 'agent_message' as const, text: '', delivery: 'async' as const,
  questions: [{ title: 'Which environment?', options: ['Staging', 'Production'] }],
}

describe('formatCodexAsyncQuestionReply', () => {
  it('sends a single answer without repeating its question', () => {
    expect(formatCodexAsyncQuestionReply(
      [{ title: 'Which environment?', options: ['Staging', 'Production'] }],
      ['Production'],
    )).toBe('Production')
  })

  it('labels answers when replying to multiple questions', () => {
    expect(formatCodexAsyncQuestionReply(
      [
        { title: 'Which environment?', options: ['Staging', 'Production'] },
        { title: 'What deadline?', options: null },
      ],
      ['Staging', 'Friday'],
    )).toBe('Which environment?\nStaging\n\nWhat deadline?\nFriday')
  })

  it('steers answers immediately and renders an answered summary', async () => {
    render(createElement(CodexAsyncQuestionBlock, {
      item: {
        id: 'question-1',
        type: 'agent_message',
        text: 'fallback',
        delivery: 'async',
        questions: [
          { title: 'Which environment?', options: ['Staging', 'Production'] },
          { title: 'What deadline?', options: null },
        ],
      },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Production' }))
    fireEvent.change(screen.getAllByPlaceholderText('chat.askUser.otherOption')[1], {
      target: { value: 'Friday' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'chat.askUser.submit' }))

    await waitFor(() => expect(steer).toHaveBeenCalledWith(
      'session-1',
      'Which environment?\nProduction\n\nWhat deadline?\nFriday',
      '',
      'codex_async_answer:question-1',
      'Which environment?\nProduction\n\nWhat deadline?\nFriday',
    ))
    await waitFor(() => expect(screen.getByText('chat.askUser.answered')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'chat.askUser.submit' })).toBeNull()
  })
  it('keeps the question pending until steer succeeds and restores the answer on remount', async () => {
    let accept!: () => void
    steer.mockImplementationOnce(() => new Promise<void>((resolve) => { accept = resolve }))
    const view = render(createElement(CodexAsyncQuestionBlock, { item: question }))
    const submit = screen.getByRole('button', { name: 'chat.askUser.submit' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(steer).toHaveBeenCalledTimes(1)
    expect(submit).toBeDisabled()
    expect(screen.queryByRole('status')).toBeNull()
    expect(useChatStore.getState().projectSessions['/project']._sessions['session-1'].messages).toHaveLength(0)
    await act(async () => accept())
    expect(screen.getByRole('status')).toHaveTextContent('chat.askUser.answered')
    view.unmount()
    render(createElement(CodexAsyncQuestionBlock, { item: question }))
    expect(screen.getByRole('status')).toHaveTextContent('chat.askUser.answered')
    expect(screen.getByText('Staging')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('preserves the answer for retry when the active turn rejects steer', async () => {
    steer.mockRejectedValueOnce(new Error('No active Codex turn to steer'))
    render(createElement(CodexAsyncQuestionBlock, { item: question }))
    fireEvent.click(screen.getByRole('button', { name: 'Production' }))
    fireEvent.click(screen.getByRole('button', { name: 'chat.askUser.submit' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No active Codex turn to steer'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Production' })).toHaveAttribute('aria-pressed', 'true')
    expect(useChatStore.getState().projectSessions['/project']._sessions['session-1'].messages).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'chat.askUser.submit' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(steer).toHaveBeenCalledTimes(2)
  })

  it('locks every input when mobile takes control and unlocks after release', () => {
    render(createElement(CodexAsyncQuestionBlock, { item: question }))
    fireEvent.click(screen.getByRole('button', { name: 'Production' }))
    act(() => useChatStore.setState({ remoteSessions: { '/project': ['session-1'] } }))
    expect(screen.getByRole('button', { name: 'Production' })).toBeDisabled()
    expect(screen.getByRole('textbox')).toBeDisabled()
    const submit = screen.getByRole('button', { name: 'chat.askUser.submit' })
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(steer).not.toHaveBeenCalled()
    act(() => useChatStore.setState({ remoteSessions: {} }))
    expect(submit).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Production' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('updates the mounted read-only question when a mobile answer arrives', () => {
    useChatStore.setState({ remoteSessions: { '/project': ['session-1'] } })
    render(createElement(CodexAsyncQuestionBlock, { item: question }))
    act(() => useChatStore.getState().handleAgentEvent({
      type: 'user_message_appended', projectPath: '/project', sessionId: 'session-1',
      message: { id: 'codex_async_answer:question-1', role: 'user', status: 'complete',
        content: [{ type: 'text', text: 'Production' }], createdAt: '', providerId: 'codex' },
    }))
    expect(screen.getByRole('status')).toHaveTextContent('chat.askUser.answered')
    expect(screen.getByText('Production')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(steer).not.toHaveBeenCalled()
  })

  it('steers the scoped pane and keeps its answer out of the foreground session', async () => {
    useChatStore.setState((state) => ({
      remoteSessions: { '/project': ['session-1'] },
      projectSessions: {
        ...state.projectSessions,
        '/project': {
          ...state.projectSessions['/project'],
          _sessions: {
            ...state.projectSessions['/project']._sessions,
            'session-2': { ...createDefaultPerSessionState(), status: 'streaming', sessionProvider: 'codex' },
          },
        },
      },
    }))
    render(createElement(SessionScopeProvider, {
      value: { projectPath: '/project', sessionId: 'session-2' },
      children: createElement(CodexAsyncQuestionBlock, { item: question }),
    }))
    fireEvent.click(screen.getByRole('button', { name: 'chat.askUser.submit' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(steer).toHaveBeenCalledWith('session-2', 'Staging', '', 'codex_async_answer:question-1', 'Staging')
    const sessions = useChatStore.getState().projectSessions['/project']._sessions
    expect(sessions['session-1'].messages).toHaveLength(0)
    expect(sessions['session-2'].messages).toHaveLength(1)
  })

})
