/** @vitest-environment jsdom */

import { createRef, type RefObject } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import { ChatRootContext } from './is-focus-in-chat'

const chatState = {
  answerQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
}

const activeSessionState = {
  pendingQuestion: {
    requestId: 'q-1',
    questions: [{
      question: 'Which library?',
      header: 'Library',
      multiSelect: false,
      options: [
        { label: 'date-fns', description: 'Immutable helpers' },
        { label: 'dayjs', description: 'Smaller bundle' },
      ],
    }],
  } as AskUserQuestionRequest | null,
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: { requestChatInputFocusRestore: () => void }) => unknown) =>
    selector({ requestChatInputFocusRestore: vi.fn() }),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
  useScopedSessionActions: () => chatState,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'

function renderInChat(ui: ReactElement) {
  const rootRef = createRef<HTMLDivElement>()
  const result = render(
    <div ref={rootRef} data-chat-root="" tabIndex={-1}>
      <ChatRootContext.Provider value={rootRef as RefObject<HTMLElement | null>}>
        {ui}
      </ChatRootContext.Provider>
    </div>,
  )
  ;(result.container.querySelector('[data-chat-root]') as HTMLElement).focus()
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  activeSessionState.pendingQuestion = {
    requestId: 'q-1',
    questions: [{
      question: 'Which library?',
      header: 'Library',
      multiSelect: false,
      options: [
        { label: 'date-fns', description: 'Immutable helpers' },
        { label: 'dayjs', description: 'Smaller bundle' },
      ],
    }],
  }
})

describe('AskUserQuestionPrompt', () => {
  it('renders options and submits the selected answer', () => {
    renderInChat(<AskUserQuestionPrompt />)
    fireEvent.click(screen.getByRole('button', { name: /date-fns/i }))
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(chatState.answerQuestion).toHaveBeenCalledWith(
      'q-1',
      { 'Which library?': 'date-fns' },
      undefined,
    )
  })

  it('selects option 1 with the digit key and submits on Enter', () => {
    renderInChat(<AskUserQuestionPrompt />)
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(chatState.answerQuestion).toHaveBeenCalledWith(
      'q-1',
      { 'Which library?': 'date-fns' },
      undefined,
    )
  })

  it('dismisses on Escape', () => {
    renderInChat(<AskUserQuestionPrompt />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(chatState.dismissQuestion).toHaveBeenCalledWith('q-1')
  })

  it('renders nothing without a pending question', () => {
    activeSessionState.pendingQuestion = null
    const { container } = renderInChat(<AskUserQuestionPrompt />)
    expect(container.querySelector('[data-chat-root]')?.textContent).toBe('')
  })
})
