/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, TodoItem } from '@superone/shared/agent-types'
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

  it('does not leak the composite codex todo id as a #prefix on each row', () => {
    activeSessionState.messages = [createCodexTodoMessage(false, 'todo_019e3769-5dd4-70b3-839c-fd1226540ad5')]

    render(<TodoPopup />)

    expect(screen.getByText('first task')).toBeTruthy()
    expect(screen.queryByText(/#todo_019e3769/)).toBeNull()
    expect(screen.queryByText('#todo_019e3769-5dd4-70b3-839c-fd1226540ad5-0')).toBeNull()
  })

  it('does not render when all codex todos are completed', () => {
    activeSessionState.messages = [createCodexTodoMessage(true)]

    render(<TodoPopup />)

    expect(screen.queryByText('Todos')).toBeNull()
    expect(screen.queryByText('first task')).toBeNull()
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

  it('renders the task owner and the #id prefix alongside the subject', () => {
    activeSessionState.todos = {
      x9: { id: 'x9', subject: 'delegated task', description: '', status: 'pending', owner: 'general-purpose' },
    }
    render(<TodoPopup />)

    expect(screen.getByText('delegated task')).toBeTruthy()
    expect(screen.getByText('general-purpose')).toBeTruthy()
    expect(screen.getByText('#x9')).toBeTruthy()
  })

  it('shows only the unfinished blocker ids in the pill, not a count', () => {
    activeSessionState.todos = {
      a1: { id: 'a1', subject: 'finished blocker', description: '', status: 'completed' },
      c3: { id: 'c3', subject: 'pending blocker', description: '', status: 'pending' },
      b2: { id: 'b2', subject: 'dependent task', description: '', status: 'pending', blockedBy: ['a1', 'c3'] },
    }
    render(<TodoPopup />)

    expect(screen.queryByText(/blocked by/)).toBeNull()
    // completed a1 filtered → chip shows only #c3; #c3 also appears as c3's own row prefix
    expect(screen.getAllByText('#c3')).toHaveLength(2)
    // completed blocker id never appears in any chip → only a1's own row prefix
    expect(screen.getAllByText('#a1')).toHaveLength(1)
  })

  it('derives the blocked-by pill from the inverse blocks edge when the agent only sent addBlocks', () => {
    activeSessionState.todos = {
      a1: { id: 'a1', subject: 'design schema', description: '', status: 'in_progress', blocks: ['b2'] },
      b2: { id: 'b2', subject: 'implement api', description: '', status: 'pending' },
    }
    render(<TodoPopup />)

    // #a1 appears as a1's own row prefix AND as b2's blocked-by chip
    expect(screen.getAllByText('#a1')).toHaveLength(2)
  })

  it('does not double-count when both the explicit blockedBy and the inverse blocks edge name the same blocker', () => {
    activeSessionState.todos = {
      a1: { id: 'a1', subject: 'pending blocker', description: '', status: 'pending', blocks: ['b2'] },
      b2: { id: 'b2', subject: 'dependent task', description: '', status: 'pending', blockedBy: ['a1'] },
    }
    render(<TodoPopup />)

    // a1 row prefix + single deduped chip on b2 = 2 (not 3)
    expect(screen.getAllByText('#a1')).toHaveLength(2)
  })

  it('auto-expands the description of the in_progress task', () => {
    activeSessionState.todos = {
      a: {
        id: 'a',
        subject: 'build it',
        description: 'wire the delta channel end to end',
        status: 'in_progress',
        activeForm: 'Building it',
      },
    }
    render(<TodoPopup />)

    expect(screen.getByText('Building it')).toBeTruthy()
    expect(screen.getByText('wire the delta channel end to end')).toBeTruthy()
  })
})
