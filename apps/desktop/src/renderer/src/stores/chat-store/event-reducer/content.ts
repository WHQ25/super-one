import type { AgentEvent, TodoItem } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { applyDelta } from '../helpers/event-helpers'
import { persistStreamingToolInput } from '../index'
import type { PerSessionState } from '../types'
import { streamingPreviewLastUpdate, streamingToolInputRaw } from './shared'

type ContentDeltaEvent = Extract<AgentEvent, { type: 'content_delta' }>

export function reduceContentDelta(session: PerSessionState, event: ContentDeltaEvent): Partial<PerSessionState> {
  const targetMsg = session.messages.find((m) => m.id === event.messageId)
  if (targetMsg && isReplayedEventForMessage(event, targetMsg)) {
    return { lastEventAt: Date.now() }
  }
  let updatedMessages = session.messages.map((msg) => {
    if (msg.id !== event.messageId) return msg
    return {
      ...msg,
      content: applyDelta(msg.content, event.delta),
      ...applySeqToMessage(event),
    }
  })

  let extraUpdates: Partial<PerSessionState> = {}
  if (session.apiRetry) extraUpdates.apiRetry = null

  if (event.delta.type === 'tool_use' && event.delta.toolUseId && event.delta.input) {
    streamingToolInputRaw.delete(event.delta.toolUseId)
    streamingPreviewLastUpdate.delete(event.delta.toolUseId)
    if (session._streamingToolInputPreviews[event.delta.toolUseId]) {
      const { [event.delta.toolUseId]: _, ...rest } = session._streamingToolInputPreviews
      extraUpdates._streamingToolInputPreviews = rest
    }
  }

  if (event.delta.type === 'tool_result') {
    const resultDelta = event.delta
    const streamingInput = streamingToolInputRaw.get(resultDelta.toolUseId)
    updatedMessages = persistStreamingToolInput(updatedMessages, event.messageId, resultDelta.toolUseId, streamingInput)
    streamingToolInputRaw.delete(resultDelta.toolUseId)
    streamingPreviewLastUpdate.delete(resultDelta.toolUseId)
    if (session._streamingToolInputPreviews[resultDelta.toolUseId]) {
      const { [resultDelta.toolUseId]: _, ...rest } = session._streamingToolInputPreviews
      extraUpdates._streamingToolInputPreviews = rest
    }
    const msg = updatedMessages.find((m) => m.id === event.messageId)
    const toolBlock = msg?.content.find(
      (b) => b.type === 'tool_use' && b.toolUseId === resultDelta.toolUseId
    )
    if (toolBlock && toolBlock.type === 'tool_use') {
      const tn = toolBlock.toolName
      if (tn === 'TodoWrite' || tn === 'TaskCreate' || tn === 'TaskUpdate') {
        try {
          const input = JSON.parse(toolBlock.input)
          if (tn === 'TodoWrite' && Array.isArray(input.todos)) {
            const newTodos: Record<string, TodoItem> = {}
            for (let i = 0; i < input.todos.length; i++) {
              const t = input.todos[i]
              const id = String(i + 1)
              newTodos[id] = {
                id,
                subject: t.content ?? t.subject ?? '',
                description: t.description ?? '',
                status: t.status ?? 'pending',
                activeForm: t.activeForm,
              }
            }
            extraUpdates = { todos: newTodos, _nextTodoId: input.todos.length + 1, ...(!session._todosUserDismissed && { showTodos: true }) }
          } else if (tn === 'TaskCreate') {
            const resolvedId = resultDelta.toolTodos?.[0]?.taskId
            const id = resolvedId ?? String(session._nextTodoId)
            extraUpdates = {
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
          } else if (tn === 'TaskUpdate' && input.taskId) {
            const existing = session.todos[input.taskId]
            if (existing) {
              if (input.status === 'deleted') {
                const { [input.taskId]: _, ...rest } = session.todos
                extraUpdates = { todos: rest }
              } else {
                const mergeIds = (prev: string[] | undefined, add: unknown): string[] | undefined => {
                  if (!Array.isArray(add) || add.length === 0) return prev
                  return Array.from(new Set([...(prev ?? []), ...add.map(String)]))
                }
                const nextBlockedBy = mergeIds(existing.blockedBy, input.addBlockedBy)
                const nextBlocks = mergeIds(existing.blocks, input.addBlocks)
                extraUpdates = {
                  ...(!session._todosUserDismissed && { showTodos: true }),
                  todos: {
                    ...session.todos,
                    [input.taskId]: {
                      ...existing,
                      ...(input.status && { status: input.status }),
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
            }
          }
        } catch { /* ignore malformed JSON */ }
      }

      if (tn === 'EnterPlanMode') {
        extraUpdates = { ...extraUpdates, permissionMode: 'plan' }
      }
      if (tn === 'ExitPlanMode' && session.planApprovalOutcome && !session.planApprovalOutcome.approved) {
        const feedback = session.planApprovalOutcome.feedback?.trim()
        const base = feedback || resultDelta.summary || 'User rejected the plan'
        const summary = base.startsWith('[denied] ') ? base : `[denied] ${base}`
        updatedMessages = updatedMessages.map((m) => {
          if (m.id !== event.messageId) return m
          const nextContent = [...m.content]
          for (let i = nextContent.length - 1; i >= 0; i--) {
            const block = nextContent[i]
            if (block.type === 'tool_result' && block.toolUseId === resultDelta.toolUseId) {
              nextContent[i] = { ...block, summary }
              break
            }
          }
          return { ...m, content: nextContent }
        })
      }
    }
  }

  return { messages: updatedMessages, lastEventAt: Date.now(), ...extraUpdates }
}
