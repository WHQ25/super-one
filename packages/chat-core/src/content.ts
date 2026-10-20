import type { AgentEvent } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { resolveDeltaHomeMessageId } from '@superone/shared/subagent-routing'
import { applyContentDelta as applyDelta } from '@superone/shared/content-delta'
import { persistStreamingToolInput } from './transformers'
import type { ChatCoreSession } from './types'
import { isMediaGenerateVideoTool, isMediaVideoStatusTool } from './media-predicates'
import { defaultChatCorePorts, type ChatCorePorts } from './ports'
import { dropHostWorkflowShadow } from './host-workflow-card'
import { dropStreamingToolInputPreview, isTerminalMessageStatus } from './shared'
import { applyTodoResult, applyTodoToolInput } from './todos'
import { queuedAsyncQuestion } from './codex'
import { codexAsyncQuestionItems } from '@superone/shared/codex-async-question'

type ContentDeltaEvent = Extract<AgentEvent, { type: 'content_delta' }>

export function reduceContentDelta(
  session: ChatCoreSession,
  event: ContentDeltaEvent,
  ports: ChatCorePorts = defaultChatCorePorts,
): Partial<ChatCoreSession> {
  const sourceMsg = session.messages.find((m) => m.id === event.messageId)
  if (sourceMsg && isReplayedEventForMessage(event, sourceMsg)) {
    return { lastEventAt: ports.now() }
  }
  // A resumed sub-agent streams into a NEW message tagged with its original
  // Agent toolUseId; re-home it under that Agent block's message so per-message
  // grouping can reunite them (else it leaks into the main conversation). Seq
  // tracking stays on the source message — it owns the stream's seq numbers.
  const homeId = resolveDeltaHomeMessageId(session.messages, event.messageId, event.delta)
  const homeMsg = session.messages.find((m) => m.id === homeId)
  // Grok wait_for can still emit in_progress after session/cancel. A streaming
  // status on a turn that already ended would revive the shimmer.
  const delta =
    isTerminalMessageStatus(homeMsg?.status)
    && event.delta.type === 'tool_use'
    && event.delta.status === 'streaming'
      ? { ...event.delta, status: 'complete' as const }
      : event.delta
  let updatedMessages = session.messages.map((msg) => {
    if (msg.id === homeId) {
      return {
        ...msg,
        content: applyDelta(msg.content, delta, ports.now, { replace: event.replace }),
        ...(homeId === event.messageId ? applySeqToMessage(event) : {}),
      }
    }
    if (homeId !== event.messageId && msg.id === event.messageId) {
      return { ...msg, ...applySeqToMessage(event) }
    }
    return msg
  })

  let extraUpdates: Partial<ChatCoreSession> = {}
  if (session.apiRetry) extraUpdates.apiRetry = null

  // A Codex async question arrives as a text block that carries it.
  if (event.delta.type === 'text' && event.delta.codexAsyncQuestions?.length) {
    const textId = event.delta.id
    const home = updatedMessages.find((m) => m.id === homeId)
    const item = home ? codexAsyncQuestionItems(home).find((entry) => entry.id === textId) : undefined
    const pendingAsyncQuestions = item ? queuedAsyncQuestion(session, homeId, item) : null
    if (pendingAsyncQuestions) extraUpdates.pendingAsyncQuestions = pendingAsyncQuestions
  }

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
    ports.streaming.clear(event.delta.toolUseId)
    const restPreviews = dropStreamingToolInputPreview(session._streamingToolInputPreviews, event.delta.toolUseId)
    if (restPreviews) extraUpdates._streamingToolInputPreviews = restPreviews
  }

  if (event.delta.type === 'tool_result') {
    const resultDelta = event.delta
    const streamingInput = ports.streaming.getRaw(resultDelta.toolUseId)
    updatedMessages = persistStreamingToolInput(updatedMessages, event.messageId, resultDelta.toolUseId, streamingInput)
    ports.streaming.clear(resultDelta.toolUseId)
    const restPreviews = dropStreamingToolInputPreview(session._streamingToolInputPreviews, resultDelta.toolUseId)
    if (restPreviews) extraUpdates._streamingToolInputPreviews = restPreviews
    const msg = updatedMessages.find((m) => m.id === event.messageId)
    const toolBlock = msg?.content.find(
      (b) => b.type === 'tool_use' && b.toolUseId === resultDelta.toolUseId
    )
    if (toolBlock && toolBlock.type === 'tool_use') {
      const tn = toolBlock.toolName
      if (!resultDelta.isError && (tn === 'TodoWrite' || tn === 'TaskCreate' || tn === 'TaskUpdate')) {
        try {
          const applied = applyTodoToolInput(session, tn, JSON.parse(toolBlock.input), resultDelta.toolTodos)
          if (applied) extraUpdates = applied
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

      if (isMediaGenerateVideoTool(tn)) {
        try {
          const result = JSON.parse(resultDelta.summary ?? '{}')
          const genId = result.generationId
          if (genId && typeof genId === 'string') {
            const input = JSON.parse(toolBlock.input)
            const prev = session.videoGenStatuses[genId]
            extraUpdates = {
              ...extraUpdates,
              videoGenStatuses: {
                ...session.videoGenStatuses,
                [genId]: {
                  status: result.status === 'error' ? 'error' : (prev?.status ?? 'submitted'),
                  generationId: genId,
                  prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
                  provider: typeof input.provider === 'string' ? input.provider : undefined,
                  model: typeof input.model === 'string' ? input.model : undefined,
                  savedPaths: Array.isArray(result.savedPaths) ? result.savedPaths : prev?.savedPaths,
                  warnings: Array.isArray(result.warnings) ? result.warnings : prev?.warnings,
                  error: result.status === 'error' ? String(result.message ?? '') : prev?.error,
                },
              },
            }
          }
        } catch { /* ignore malformed JSON */ }
      }

      if (isMediaVideoStatusTool(tn)) {
        try {
          const input = JSON.parse(toolBlock.input)
          const genId = input.generation_id
          if (genId && typeof genId === 'string') {
            const result = JSON.parse(resultDelta.summary ?? '{}')
            const prev = session.videoGenStatuses[genId]
            extraUpdates = {
              ...extraUpdates,
              videoGenStatuses: {
                ...session.videoGenStatuses,
                [genId]: {
                  ...(prev ?? { status: 'running', generationId: genId }),
                  status: result.status === 'error' ? 'error' : (result.status === 'generated' ? 'generated' : 'running'),
                  savedPaths: Array.isArray(result.savedPaths) ? result.savedPaths : prev?.savedPaths,
                  warnings: Array.isArray(result.warnings) ? result.warnings : prev?.warnings,
                  error: result.status === 'error' ? String(result.message ?? '') : prev?.error,
                },
              },
            }
          }
        } catch { /* ignore malformed JSON */ }
      }
    }
    const stripped = dropHostWorkflowShadow(updatedMessages, resultDelta.toolUseId, resultDelta.summary)
    if (stripped) updatedMessages = stripped
  }

  // A windowed remote row has already dropped the call. The result carries the list.
  if (event.delta.type === 'todo_result') {
    const resultDelta = event.delta
    ports.streaming.clear(resultDelta.toolUseId)
    const restPreviews = dropStreamingToolInputPreview(session._streamingToolInputPreviews, resultDelta.toolUseId)
    if (restPreviews) extraUpdates._streamingToolInputPreviews = restPreviews
    const applied = applyTodoResult(session, resultDelta)
    if (applied) extraUpdates = { ...extraUpdates, ...applied }
  }

  return { messages: updatedMessages, lastEventAt: ports.now(), ...extraUpdates }
}
