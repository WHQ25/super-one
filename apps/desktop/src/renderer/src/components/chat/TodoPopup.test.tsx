/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexTodoListItem, TodoItem } from '@superone/shared/agent-types'
import type { ReactNode } from 'react'

const chatState = {
  toggleTodos: vi.fn(),
}

const activeSessionState: {
  todos: Record<string, TodoItem>
  showTodos: boolean
  _todosUserDismissed: boolean
  _latestCodexTodoList: CodexTodoListItem | null
} = {
  todos: {},
  showTodos: true,
  _todosUserDismissed: false,
  _latestCodexTodoList: null,
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

function createCodexTodoList(completed = false, id = 'todo-1'): CodexTodoListItem {
  return {
    id,
    type: 'todo_list',
    items: [
      { text: 'first task', completed },
      { text: 'second task', completed: true },
    ],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  activeSessionState.todos = {}
  activeSessionState.showTodos = true
  activeSessionState._todosUserDismissed = false
  activeSessionState._latestCodexTodoList = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TodoPopup', () => {
  it('renders the latest codex todo list', () => {
    activeSessionState._latestCodexTodoList = createCodexTodoList()

    render(<TodoPopup />)

    expect(screen.getByText('Todos (1/2)')).toBeTruthy()
    expect(screen.getByText('first task')).toBeTruthy()
    expect(screen.getByText('second task')).toBeTruthy()
  })

  it('does not leak the composite codex todo id as a #prefix on each row', () => {
    activeSessionState._latestCodexTodoList = createCodexTodoList(false, 'todo_019e3769-5dd4-70b3-839c-fd1226540ad5')

    render(<TodoPopup />)

    expect(screen.getByText('first task')).toBeTruthy()
    expect(screen.queryByText(/#todo_019e3769/)).toBeNull()
    expect(screen.queryByText('#todo_019e3769-5dd4-70b3-839c-fd1226540ad5-0')).toBeNull()
  })

  it('does not render when all codex todos are completed', () => {
    // Store field is null when every item completed (derive helper).
    activeSessionState._latestCodexTodoList = null

    render(<TodoPopup />)

    expect(screen.queryByText('Todos')).toBeNull()
  })

  it('auto-opens when a codex todo list arrives while collapsed', () => {
    activeSessionState.showTodos = false
    activeSessionState._latestCodexTodoList = createCodexTodoList()

    render(<TodoPopup />)

    expect(chatState.toggleTodos).toHaveBeenCalled()
  })

  it('prefers session todos over the codex todo list', () => {
    activeSessionState._latestCodexTodoList = createCodexTodoList()
    activeSessionState.todos = {
      '1': {
        id: '1',
        subject: 'session todo',
        description: '',
        status: 'pending',
      },
    }

    render(<TodoPopup />)

    expect(screen.getByText('session todo')).toBeTruthy()
    expect(screen.queryByText('first task')).toBeNull()
  })

  it('shows a new codex todo list after the previous completed one auto-hides', () => {
    activeSessionState._latestCodexTodoList = null
    const { rerender } = render(<TodoPopup />)
    expect(screen.queryByText('first task')).toBeNull()

    activeSessionState._latestCodexTodoList = createCodexTodoList(false, 'todo-2')
    rerender(<TodoPopup />)

    expect(screen.getByText('first task')).toBeTruthy()
  })
})
