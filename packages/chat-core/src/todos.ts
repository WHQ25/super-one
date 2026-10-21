import type { AgentEvent, ChatMessage, TodoItem, TodoToolItem } from '@superone/shared/agent-types'
import type { ChatCoreSession } from './types'

type TodosUpdatedEvent = Extract<AgentEvent, { type: 'todos_updated' }>

/** How long a fully completed list stays readable before a client clears it. */
export const COMPLETED_TODO_CLEAR_MS = 3_000

/** True when the list has rows and every one is done. An empty list is not finished. */
export function todosAllCompleted(todos: Iterable<{ status: string }>): boolean {
  let count = 0
  for (const todo of todos) {
    count += 1
    if (todo.status !== 'completed') return false
  }
  return count > 0
}

export function reduceTodosUpdated(session: ChatCoreSession, event: TodosUpdatedEvent): Partial<ChatCoreSession> {
  const todos = Object.fromEntries(event.todos.map((todo): [string, TodoItem] => [todo.id, todo]))
  return {
    todos,
    _nextTodoId: event.todos.length + 1,
    ...(!session._todosUserDismissed && { showTodos: event.todos.length > 0 }),
  }
}

/** The list a `TodoWrite` call sets, keyed by position; null when the input carries none. */
export function todoWriteTodos(input: { todos?: unknown }): Record<string, TodoItem> | null {
  if (!Array.isArray(input.todos)) return null
  return Object.fromEntries(input.todos.map((todo: Record<string, unknown>, index): [string, TodoItem] => {
    const id = String(index + 1)
    return [id, {
      id,
      subject: String(todo.content ?? todo.subject ?? ''),
      description: String(todo.description ?? ''),
      status: (todo.status as TodoItem['status']) ?? 'pending',
      activeForm: todo.activeForm as string | undefined,
    }]
  }))
}

/** Replace the session's list, opening the panel unless the user put it away. */
export function todoListUpdate(session: Pick<ChatCoreSession, '_todosUserDismissed'>, todos: Record<string, TodoItem>): Partial<ChatCoreSession> {
  return { todos, _nextTodoId: Object.keys(todos).length + 1, ...(!session._todosUserDismissed && { showTodos: true }) }
}

const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate'])

/**
 * Cold host snapshot for a phone that missed live `todos_updated` events.
 * A replayed update wins, including a clear, so an older TodoWrite cannot bring the list back.
 */
export function withTranscriptTodos(
  state: ChatCoreSession,
  messages: readonly ChatMessage[],
  replayedTodosUpdated: boolean,
): ChatCoreSession {
  if (replayedTodosUpdated) return state
  const restored = restoredTodos(messages)
  if (!restored) return state
  return { ...state, ...todoListUpdate(state, restored) }
}

/**
 * The newest todo tool in one message. A later `TaskCreate` / `TaskUpdate`
 * clears a cold restore; only an open `TodoWrite` list comes back.
 * `found` is false when the message has no todo tool, so a search can continue.
 */
export function todoRestoreDecision(message: ChatMessage): { found: true; todos: Record<string, TodoItem> | null } | { found: false } {
  const content = message.content
  for (let b = content.length - 1; b >= 0; b--) {
    const block = content[b]!
    if (block.type !== 'tool_use' || !TODO_TOOLS.has(block.toolName)) continue
    if (block.toolName !== 'TodoWrite') return { found: true, todos: null }
    let todos: Record<string, TodoItem> | null = null
    try { todos = todoWriteTodos(JSON.parse(block.input)) } catch { return { found: true, todos: null } }
    return { found: true, todos: todos && Object.values(todos).some(todo => todo.status !== 'completed') ? todos : null }
  }
  return { found: false }
}

/**
 * The open list a cold restore brings back: the latest todo call's list when it
 * was a whole-list `TodoWrite` and not every todo is done. Task tools build a
 * list across calls, which a restore cannot replay.
 */
export function restoredTodos(messages: readonly ChatMessage[]): Record<string, TodoItem> | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const decision = todoRestoreDecision(messages[m]!)
    if (decision.found) return decision.todos
  }
  return null
}

type TodoSession = Pick<ChatCoreSession, 'todos' | '_nextTodoId' | '_todosUserDismissed'>

interface TodoToolInput {
  todos?: unknown
  subject?: string
  description?: string
  activeForm?: string
  taskId?: string
  status?: string
  owner?: string
  addBlockedBy?: unknown
  addBlocks?: unknown
}

/**
 * The list change a Claude todo tool makes. `TodoWrite` replaces the list.
 * `TaskCreate` upserts by the result's task id. `TaskUpdate` merges, or
 * deletes. A missing target is a no-op, so applying the same call again does
 * not duplicate a task or bump the id counter.
 */
export function applyTodoToolInput(
  session: TodoSession,
  toolName: string,
  input: TodoToolInput,
  resultToolTodos?: ReadonlyArray<{ taskId?: string }>,
): Partial<ChatCoreSession> | null {
  if (toolName === 'TodoWrite') {
    const listed = todoWriteTodos(input)
    return listed ? todoListUpdate(session, listed) : null
  }
  if (toolName === 'TaskCreate') {
    const resolvedId = resultToolTodos?.[0]?.taskId
    const id = resolvedId ?? String(session._nextTodoId)
    return {
      ...(resolvedId ? {} : { _nextTodoId: session._nextTodoId + 1 }),
      showTodos: !session._todosUserDismissed,
      todos: {
        ...session.todos,
        [id]: {
          id,
          subject: input.subject ?? '',
          description: input.description ?? '',
          status: 'pending',
          activeForm: input.activeForm,
        },
      },
    }
  }
  if (toolName === 'TaskUpdate' && input.taskId) return mergeTaskUpdate(session, input.taskId, input)
  return null
}

/**
 * A `todo_result` whose call is no longer on the message. The items are the
 * original tool input (a window has already dropped that call). An error
 * result carries no items and changes nothing.
 */
export function applyTodoResult(
  session: TodoSession,
  delta: { todoToolName?: string; toolTodos?: readonly TodoToolItem[] },
): Partial<ChatCoreSession> | null {
  const items = delta.toolTodos
  const toolName = delta.todoToolName
  if (!items || !toolName) return null
  if (toolName === 'TodoWrite') {
    return applyTodoToolInput(session, toolName, {
      todos: items.map((item) => ({
        content: item.subject ?? item.content,
        description: item.description,
        status: item.status,
        activeForm: item.activeForm,
      })),
    })
  }
  const item = items[0]
  if (!item) return null
  if (toolName === 'TaskCreate') {
    return applyTodoToolInput(session, toolName, {
      subject: item.subject ?? item.content,
      description: item.description,
      activeForm: item.activeForm,
    }, item.taskId ? [{ taskId: item.taskId }] : undefined)
  }
  if (toolName === 'TaskUpdate') {
    return applyTodoToolInput(session, toolName, {
      taskId: item.taskId,
      status: item.status || undefined,
      subject: item.subject,
      description: item.description,
      activeForm: item.activeForm,
      owner: item.owner,
      addBlockedBy: item.addBlockedBy,
      addBlocks: item.addBlocks,
    })
  }
  return null
}

function mergeTaskUpdate(session: TodoSession, taskId: string, input: TodoToolInput): Partial<ChatCoreSession> | null {
  const existing = session.todos[taskId]
  if (!existing) return null
  if (input.status === 'deleted') {
    const { [taskId]: _, ...rest } = session.todos
    return { todos: rest }
  }
  const mergeIds = (prev: string[] | undefined, add: unknown): string[] | undefined => {
    if (!Array.isArray(add) || add.length === 0) return prev
    return Array.from(new Set([...(prev ?? []), ...add.map(String)]))
  }
  const nextBlockedBy = mergeIds(existing.blockedBy, input.addBlockedBy)
  const nextBlocks = mergeIds(existing.blocks, input.addBlocks)
  return {
    ...(!session._todosUserDismissed && { showTodos: true }),
    todos: {
      ...session.todos,
      [taskId]: {
        ...existing,
        ...(input.status && { status: input.status as TodoItem['status'] }),
        ...(input.subject && { subject: input.subject }),
        ...(input.description && { description: input.description }),
        ...(input.activeForm && { activeForm: input.activeForm }),
        ...(input.owner && { owner: input.owner }),
        ...(nextBlockedBy && { blockedBy: nextBlockedBy }),
        ...(nextBlocks && { blocks: nextBlocks }),
      },
    },
  }
}
