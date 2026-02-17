import { useEffect, useCallback, useRef } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { ListTodo, Circle, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CommandShortcut } from '@/components/ui/command'

export function TodoPopup() {
  const todos = useActiveSession((s) => s.todos)
  const showTodos = useActiveSession((s) => s.showTodos)
  const toggleTodos = useChatStore((s) => s.toggleTodos)
  const activeRef = useRef<HTMLDivElement>(null)
  const isCoding = useAppStore((s) => s.layoutMode) === 'coding'

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

  useEffect(() => {
    if (showTodos && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center' })
    }
  }, [showTodos, todos])

  const todoList = Object.values(todos)

  // Auto-clear 3s after all todos completed
  const allDone = todoList.length > 0 && todoList.every((t) => t.status === 'completed')
  useEffect(() => {
    if (!allDone) return
    const timer = setTimeout(() => {
      const activeProject = useChatStore.getState().activeProject
      if (activeProject) {
        const s = useChatStore.getState()
        const session = s.projectSessions[activeProject]
        if (session) {
          useChatStore.setState({
            projectSessions: {
              ...s.projectSessions,
              [activeProject]: { ...session, todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false },
            },
          })
        }
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [allDone])

  if (todoList.length === 0) return null

  const completed = todoList.filter((t) => t.status === 'completed').length

  return (
    <div className={cn(
      'flex shrink-0 flex-col overflow-hidden',
      isCoding
        ? 'mx-3 mb-1 rounded-lg border border-border'
        : 'border-t border-border'
    )}>
      {/* Header — always visible */}
      <div
        className="flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-1.5 hover:bg-muted/30"
        onClick={toggleTodos}
      >
        <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Todos ({completed}/{todoList.length})
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          <CommandShortcut className="rounded bg-muted px-1 py-0.5">{showTodos ? 'ESC' : 'Ctrl+T'}</CommandShortcut>
        </span>
      </div>

      {/* List — only when expanded */}
      {showTodos && (
        <div className="max-h-[100px] overflow-y-auto border-t border-border p-1">
          {todoList.map((todo) => (
            <div
              key={todo.id}
              ref={todo.status === 'in_progress' ? activeRef : undefined}
              className="flex items-start gap-2 rounded px-2 py-1 text-xs"
            >
              {todo.status === 'completed' ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-500" />
              ) : todo.status === 'in_progress' ? (
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-blue-400" />
              ) : (
                <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  'min-w-0 flex-1 leading-snug',
                  todo.status === 'completed' && 'text-muted-foreground line-through'
                )}
              >
                {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.subject}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
