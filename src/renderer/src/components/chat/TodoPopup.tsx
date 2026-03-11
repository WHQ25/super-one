import { useEffect, useCallback, useMemo, useState } from 'react'
import type { ChatMessage, CodexTodoListItem } from '../../../../shared/agent-types'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { TodoListPanel } from './TodoListPanel'

function findLatestCodexTodoList(messages: ChatMessage[]): CodexTodoListItem | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]
    const items = message.metadata?.codex?.items
    if (!items) continue
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex--) {
      const item = items[itemIndex]
      if (item.type === 'todo_list') return item
    }
  }
  return null
}

export function TodoPopup() {
  const todos = useActiveSession((s) => s.todos)
  const messages = useActiveSession((s) => s.messages)
  const showTodos = useActiveSession((s) => s.showTodos)
  const todosUserDismissed = useActiveSession((s) => s._todosUserDismissed)
  const toggleTodos = useChatStore((s) => s.toggleTodos)
  const isCoding = useAppStore((s) => s.layoutMode) === 'coding'
  const [dismissedCodexTodoId, setDismissedCodexTodoId] = useState<string | null>(null)

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
  const codexTodoList = useMemo(() => findLatestCodexTodoList(messages), [messages])
  const usingSessionTodos = sessionTodoList.length > 0
  const usingCodexTodos = !usingSessionTodos && codexTodoList !== null
  const codexTodoDismissed = codexTodoList !== null && dismissedCodexTodoId === codexTodoList.id

  useEffect(() => {
    if (!codexTodoList || dismissedCodexTodoId !== codexTodoList.id) return
    if (codexTodoList.items.some((item) => !item.completed)) {
      setDismissedCodexTodoId(null)
    }
  }, [codexTodoList, dismissedCodexTodoId])

  useEffect(() => {
    if (!usingCodexTodos || codexTodoDismissed || showTodos || todosUserDismissed) return
    toggleTodos()
  }, [codexTodoDismissed, showTodos, todosUserDismissed, toggleTodos, usingCodexTodos])

  const codexAllDone = usingCodexTodos && (codexTodoList?.items.length ?? 0) > 0 && codexTodoList!.items.every((item) => item.completed)
  useEffect(() => {
    if (!codexAllDone || !codexTodoList || codexTodoDismissed) return
    const timer = setTimeout(() => {
      setDismissedCodexTodoId(codexTodoList.id)
    }, 3000)
    return () => clearTimeout(timer)
  }, [codexAllDone, codexTodoDismissed, codexTodoList])

  const allDone = usingSessionTodos && sessionTodoList.length > 0 && sessionTodoList.every((t) => t.status === 'completed')
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
    }, 3000)
    return () => clearTimeout(timer)
  }, [allDone])

  if (!usingSessionTodos && (!usingCodexTodos || codexTodoDismissed)) return null

  const panelItems = usingSessionTodos
    ? sessionTodoList.map((todo) => ({
        id: todo.id,
        text: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.subject,
        status: todo.status,
      }))
    : (codexTodoList?.items ?? []).map((todo, index) => ({
        id: `${codexTodoList?.id ?? 'todo'}-${index}`,
        text: todo.text,
        status: todo.completed ? 'completed' as const : 'pending' as const,
      }))

  return (
    <TodoListPanel
      items={panelItems}
      expanded={showTodos}
      onToggle={toggleTodos}
      trailing={<Kbd className="ml-auto">{showTodos ? 'esc' : '⌃T'}</Kbd>}
      className={cn(
        isCoding
          ? 'mx-3 mb-1 rounded-lg border border-border'
          : 'border-t border-border',
      )}
    />
  )
}
