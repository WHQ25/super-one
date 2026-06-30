import type { AgentEvent, TodoItem } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { resolveDeltaHomeMessageId } from '@superone/shared/subagent-routing'
import { applyDelta } from '../helpers/event-helpers'
import { persistStreamingToolInput } from '../index'
import type { PerSessionState } from '../types'
import { streamingPreviewLastUpdate, streamingToolInputRaw } from './shared'

type ContentDeltaEvent = Extract<AgentEvent, { type: 'content_delta' }>

export function reduceContentDelta(session: PerSessionState, event: ContentDeltaEvent): Partial<PerSessionState> {
  const sourceMsg = session.messages.find((m) => m.id === event.messageId)
  if (sourceMsg && isReplayedEventForMessage(event, sourceMsg)) {
    return { lastEventAt: Date.now() }
  }
  // A resumed sub-agent streams into a NEW message tagged with its original
  // Agent toolUseId; re-home it under that Agent block's message so per-message
  // grouping can reunite them (else it leaks into the main conversation). Seq
  // tracking stays on the source message — it owns the stream's seq numbers.
  const homeId = resolveDeltaHomeMessageId(session.messages, event.messageId, event.delta)
  let updatedMessages = session.messages.map((msg) => {
    if (msg.id === homeId) {
      return {
        ...msg,
        content: applyDelta(msg.content, event.delta),
        ...(homeId === event.messageId ? applySeqToMessage(event) : {}),
      }
    }
    if (homeId !== event.messageId && msg.id === event.messageId) {
      return { ...msg, ...applySeqToMessage(event) }
    }
    return msg
  })

  let extraUpdates: Partial<PerSessionState> = {}
  if (session.apiRetry) extraUpdates.apiRetry = null

  // New content arriving for a sub-agent we already marked complete means it was
  // resumed — re-open its running state so the activity panel surfaces it again.
  const parentId = 'parentToolUseId' in event.delta ? event.delta.parentToolUseId : null
  if (parentId && session.taskProgress[parentId]?.completed) {
    extraUpdates.taskProgress = {
      ...session.taskProgress,
      [parentId]: { ...session.taskProgress[parentId], completed: false, status: undefined },
    }
  }

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
      if (!resultDelta.isError && (tn === 'TodoWrite' || tn === 'TaskCreate' || tn === 'TaskUpdate')) {
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
