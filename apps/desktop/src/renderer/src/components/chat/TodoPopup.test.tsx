/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodoItem } from '@superone/shared/agent-types'
import type { ReactNode } from 'react'

const chatState = {
  toggleTodos: vi.fn(),
}

const activeSessionState: {
  todos: Record<string, TodoItem>
  showTodos: boolean
  _todosUserDismissed: boolean
} = {
  todos: {},
  showTodos: true,
  _todosUserDismissed: false,
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useActiveSession: (selector: (state: typeof activeSessionState) => unknown) => selector(activeSessionState),
}))

vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

// shadcn kbd path used by TodoPopup
vi.mock('@superone/ui/components/ui/kbd', () => ({
  Kbd: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

import { TodoPopup } from './TodoPopup'

/** The list every harness sets: Claude's TodoWrite/Task tools and Codex todo lists alike. */
function todoList(firstDone = false): Record<string, TodoItem> {
  return {
    '1': { id: '1', subject: 'first task', description: '', status: firstDone ? 'completed' : 'pending' },
    '2': { id: '2', subject: 'second task', description: '', status: 'completed' },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  activeSessionState.todos = {}
  activeSessionState.showTodos = true
  activeSessionState._todosUserDismissed = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TodoPopup', () => {
  it('renders the session todo list with its progress', () => {
    activeSessionState.todos = todoList()

    render(<TodoPopup />)

    expect(screen.getByText('Todos (1/2)')).toBeTruthy()
    expect(screen.getByText('first task')).toBeTruthy()
    expect(screen.getByText('second task')).toBeTruthy()
  })

  it('renders nothing without todos', () => {
    render(<TodoPopup />)

    expect(screen.queryByText(/Todos/)).toBeNull()
  })

  it('shows a new list after the previous one was cleared', () => {
    const { rerender } = render(<TodoPopup />)
    expect(screen.queryByText('first task')).toBeNull()

    activeSessionState.todos = todoList()
    act(() => rerender(<TodoPopup />))

    expect(screen.getByText('first task')).toBeTruthy()
  })
})
