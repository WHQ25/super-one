/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessage = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { sendMessage: () => Promise<void> }) => unknown) => selector({
    sendMessage,
  }),
  useSessionScope: () => ({ projectPath: '/project', sessionId: 'session-1' }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { CodexAsyncQuestionBlock, formatCodexAsyncQuestionReply } from './CodexAsyncQuestionBlock'

beforeEach(() => {
  sendMessage.mockClear()
})

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

  it('submits selected and free-text answers as a scoped user message', async () => {
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

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      'Which environment?\nProduction\n\nWhat deadline?\nFriday',
      undefined,
      undefined,
      undefined,
      { projectPath: '/project', sessionId: 'session-1' },
    ))
  })
})
