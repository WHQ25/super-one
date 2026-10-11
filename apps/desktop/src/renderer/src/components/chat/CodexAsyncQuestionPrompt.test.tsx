/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'
import { SessionScopeProvider, useChatStore } from '@/stores/chat'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { DecisionComposer } from './DecisionComposer'
import { CodexAsyncQuestionPrompt } from './CodexAsyncQuestionPrompt'
import { ChatMessage as Message } from './ChatMessage'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }) }))
const answer = vi.fn<(...args: unknown[]) => Promise<{ reply: string }>>(async () => ({ reply: 'Production' }))
const turn: ChatMessage = {
  id: 'turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex',
  metadata: { codex: { threadId: 'thread', usage: null, items: [
    { id: 'first', type: 'agent_message', delivery: 'async', text: '', questions: [{ title: 'Which environment?', options: ['Staging', 'Production'] }] },
    { id: 'second', type: 'agent_message', delivery: 'async', text: '', questions: [{ title: 'What deadline?', options: null }] },
  ] } },
}
const session = () => useChatStore.getState().projectSessions['/project']._sessions['session-1']
beforeEach(() => {
  answer.mockReset()
  answer.mockResolvedValue({ reply: 'Production' })
  window.environment = { callSession: answer } as unknown as typeof window.environment
  useChatStore.setState({ remoteSessions: {}, activeProject: '/project', projectSessions: { '/project': {
    ...createDefaultProjectState(), _activeSessionId: 'session-1', _sessions: {
      'session-1': { ...createDefaultPerSessionState(), status: 'streaming', sessionProvider: 'codex', messages: [turn] },
    },
  } } })
})
afterEach(cleanup)

describe('Codex async question decisions', () => {
  it('keeps one question interactive until acceptance, then advances and renders a Q&A user bubble', async () => {
    let accept!: (value: { reply: string }) => void
    answer.mockImplementationOnce(() => new Promise(resolve => { accept = resolve }))
    render(<div data-chat-root=""><DecisionComposer /></div>)
    expect(screen.queryByText('What deadline?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Production/ }))
    const submit = screen.getByRole('button', { name: /chat.askUser.submit/ })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(answer).toHaveBeenCalledTimes(1)
    expect(submit).toBeDisabled()
    expect(pendingCodexAsyncQuestions(session().messages)).toHaveLength(2)
    await act(async () => accept({ reply: 'Production' }))
    expect(screen.getByText('What deadline?')).toBeInTheDocument()
    const reply = session().messages.find(message => message.id === 'codex_async_answer:first')!
    expect(reply.content).toEqual([{ type: 'text', text: 'Production', codexAsyncQuestions: turn.metadata!.codex!.items[0]!.type === 'agent_message' ? turn.metadata!.codex!.items[0]!.questions : [] }])
    render(<Message message={reply} sessionStatus="streaming" isLastAssistant={false} />)
    const bubble = screen.getByText('Production').closest('.portable-user-message')!
    expect(bubble).toHaveTextContent('Which environment?')
    expect(bubble).toHaveTextContent('Production')
    expect(bubble).not.toHaveTextContent('chat.askUser.yourAnswer')
    expect(bubble.querySelector('blockquote')).toHaveTextContent('Which environment?')
    expect(answer).toHaveBeenCalledWith('local', 'session-1', 'session.answerAsyncQuestion', { messageId: 'turn', itemId: 'first', answers: ['Production'] })
  })

  it('preserves the answer and queue position when delivery fails, and allows retry', async () => {
    answer.mockRejectedValueOnce(new Error('Connection lost'))
    render(<div data-chat-root=""><DecisionComposer /></div>)
    fireEvent.click(screen.getByRole('button', { name: /Production/ }))
    fireEvent.click(screen.getByRole('button', { name: /chat.askUser.submit/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Connection lost'))
    expect(screen.queryByText('What deadline?')).toBeNull()
    expect(session().messages).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /chat.askUser.submit/ }))
    await waitFor(() => expect(screen.getByText('What deadline?')).toBeInTheDocument())
    expect(answer.mock.calls.map(call => (call[3] as { answers: string[] }).answers)).toEqual([['Production'], ['Production']])
  })

  it('locks controls when a phone takes control and advances when its answer arrives', () => {
    render(<div data-chat-root=""><DecisionComposer /></div>)
    act(() => useChatStore.setState({ remoteSessions: { '/project': ['session-1'] } }))
    expect(screen.getByRole('button', { name: /Production/ })).toBeDisabled()
    act(() => useChatStore.getState().handleAgentEvent({ type: 'user_message_appended', projectPath: '/project', sessionId: 'session-1',
      message: { id: 'codex_async_answer:first', role: 'user', status: 'complete', providerId: 'codex', createdAt: '', content: [{ type: 'text', text: 'Production' }] },
    }))
    expect(screen.getByText('What deadline?')).toBeInTheDocument()
    expect(answer).not.toHaveBeenCalled()
  })

  it('targets the scoped pane even if the foreground session is locked', async () => {
    useChatStore.setState(state => ({ remoteSessions: { '/project': ['session-1'] }, projectSessions: { '/project': {
      ...state.projectSessions['/project'], _sessions: { ...state.projectSessions['/project']._sessions,
        'session-2': { ...createDefaultPerSessionState(), status: 'streaming', sessionProvider: 'codex', messages: [turn] },
      },
    } } }))
    render(<SessionScopeProvider value={{ projectPath: '/project', sessionId: 'session-2' }}>
      <CodexAsyncQuestionPrompt question={pendingCodexAsyncQuestions([turn])[0]!} />
    </SessionScopeProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Production/ }))
    fireEvent.click(screen.getByRole('button', { name: /chat.askUser.submit/ }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith('local', 'session-2', 'session.answerAsyncQuestion', { messageId: 'turn', itemId: 'first', answers: ['Production'] }))
    expect(session().messages).toHaveLength(1)
    await waitFor(() => expect(useChatStore.getState().projectSessions['/project']._sessions['session-2'].messages).toHaveLength(2))
  })
})
