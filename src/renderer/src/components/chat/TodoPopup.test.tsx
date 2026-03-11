/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, TodoItem } from '../../../../shared/agent-types'
import type { ReactNode } from 'react'

const chatState = {
  toggleTodos: vi.fn(),
}

const activeSessionState: {
  todos: Record<string, TodoItem>
  messages: ChatMessage[]
  showTodos: boolean
  _todosUserDismissed: boolean
} = {
  todos: {},
  messages: [],
  showTodos: true,
  _todosUserDismissed: false,
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: (selector: (state: { layoutMode: 'coding' | 'canvas' }) => unknown) => selector({ layoutMode: 'coding' }),
}))

vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

import { TodoPopup } from './TodoPopup'

function createCodexTodoMessage(completed = false, id = 'todo-1'): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    status: 'complete',
    content: [],
    createdAt: '2026-03-12T00:00:00.000Z',
    providerId: 'codex',
    metadata: {
      codex: {
        threadId: 'thread-1',
        usage: null,
        items: [
          {
            id,
            type: 'todo_list',
            items: [
              { text: 'first task', completed },
              { text: 'second task', completed: true },
            ],
          },
        ],
      },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  activeSessionState.todos = {}
  activeSessionState.messages = []
  activeSessionState.showTodos = true
  activeSessionState._todosUserDismissed = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TodoPopup', () => {
  it('renders the latest codex todo list', () => {
    activeSessionState.messages = [createCodexTodoMessage()]

    render(<TodoPopup />)

    expect(screen.getByText('Todos (1/2)')).toBeTruthy()
    expect(screen.getByText('first task')).toBeTruthy()
    expect(screen.getByText('second task')).toBeTruthy()
  })

  it('hides a completed codex todo list after 3 seconds', () => {
    activeSessionState.messages = [createCodexTodoMessage(true)]

    render(<TodoPopup />)

    expect(screen.getByText('Todos (2/2)')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Todos (2/2)')).toBeNull()
  })

  it('auto-opens when a codex todo list arrives while collapsed', () => {
    activeSessionState.messages = [createCodexTodoMessage()]
    activeSessionState.showTodos = false

    render(<TodoPopup />)

    expect(chatState.toggleTodos).toHaveBeenCalledTimes(1)
  })

  it('prefers session todos over the codex todo list', () => {
    activeSessionState.todos = {
      '1': {
        id: '1',
        subject: 'session task',
        description: '',
        status: 'pending',
      },
    }
    activeSessionState.messages = [createCodexTodoMessage()]

    render(<TodoPopup />)

    expect(screen.getByText('session task')).toBeTruthy()
    expect(screen.queryByText('first task')).toBeNull()
  })

  it('shows a new codex todo list after the previous completed one auto-hides', () => {
    activeSessionState.messages = [createCodexTodoMessage(true, 'todo-1')]

    const { rerender } = render(<TodoPopup />)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Todos (2/2)')).toBeNull()

    activeSessionState.messages = [createCodexTodoMessage(false, 'todo-2')]
    rerender(<TodoPopup />)

    expect(screen.getByText('Todos (1/2)')).toBeTruthy()
    expect(screen.getByText('first task')).toBeTruthy()
  })
})
