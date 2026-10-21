import { useEffect, useCallback } from 'react'
import { COMPLETED_TODO_CLEAR_MS, todosAllCompleted } from '@superone/chat-core'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useShallow } from 'zustand/react/shallow'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { TodoListPanel } from './TodoListPanel'

export function TodoPopup() {
  // Narrow selectors only — never subscribe to full messages (stream hot path).
  const { todos, showTodos } = useActiveSession(useShallow((s) => ({
    todos: s.todos,
    showTodos: s.showTodos,
  })))
  const toggleTodos = useChatStore((s) => s.toggleTodos)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        toggleTodos()
      }
    },
    [toggleTodos]
  )

  useEffect(() => {
    if (!showTodos) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showTodos, handleKeyDown])

  const sessionTodoList = Object.values(todos)
  const allDone = todosAllCompleted(sessionTodoList)
  useEffect(() => {
    if (!allDone) return
    const timer = setTimeout(() => {
      const activeProject = useChatStore.getState().activeProject
      if (activeProject) {
        const s = useChatStore.getState()
        const project = s.projectSessions[activeProject]
        if (project && project._activeSessionId) {
          const sid = project._activeSessionId
          const sess = project._sessions[sid]
          if (sess) {
            useChatStore.setState({
              projectSessions: {
                ...s.projectSessions,
                [activeProject]: {
                  ...project,
                  _sessions: {
                    ...project._sessions,
                    [sid]: { ...sess, todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false },
                  },
                },
              },
            })
          }
        }
      }
    }, COMPLETED_TODO_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [allDone])

  if (sessionTodoList.length === 0) return null

  const inverseBlockers: Record<string, string[]> = {}
  for (const t of sessionTodoList) {
    for (const blockedId of t.blocks ?? []) {
      if (!inverseBlockers[blockedId]) inverseBlockers[blockedId] = []
      inverseBlockers[blockedId].push(t.id)
    }
  }

  const panelItems = sessionTodoList.map((todo) => ({
    id: todo.id,
    text: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.subject,
    status: todo.status,
    description: todo.description || undefined,
    owner: todo.owner,
    blockedBy: Array.from(new Set([...(todo.blockedBy ?? []), ...(inverseBlockers[todo.id] ?? [])]))
      .filter((blockerId) => todos[blockerId] && todos[blockerId].status !== 'completed')
      .map((blockerId) => todos[blockerId].id),
  }))

  return (
    <TodoListPanel
      items={panelItems}
      expanded={showTodos}
      onToggle={toggleTodos}
      trailing={<Kbd className="ml-auto">{showTodos ? 'esc' : '⌃T'}</Kbd>}
      className="mx-3 mb-1 rounded-lg border border-border"
    />
  )
}
