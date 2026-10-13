import {
  readOpenCodeConfig,
  isOpenCodeTerminalTabsPermission,
  mapOpenCodePermissionRequest,
  mapOpenCodeQuestionRequest,
  mapOpenCodeTodos,
  routeOpenCodeTodoEvent,
  openCodeToolName,
  openCodeToolInput,
  textFromOpenCodePart,
  commonPrefixLength,
  openCodeErrorMessage,
  openCodeAssistantMetadata,
} from './event-helpers'
export {
  readOpenCodeConfig,
  isOpenCodeTerminalTabsPermission,
  mapOpenCodePermissionRequest,
  mapOpenCodeQuestionRequest,
  mapOpenCodeTodos,
  routeOpenCodeTodoEvent,
  openCodeToolName,
  openCodeToolInput,
  textFromOpenCodePart,
  commonPrefixLength,
  openCodeErrorMessage,
  openCodeAssistantMetadata,
} from './event-helpers'
import type { Event, Message, Part, Todo } from '@opencode-ai/sdk/v2'
import type {
  AgentErrorInfo,
  AgentEvent,
  AskUserQuestionRequest,
  MessageMetadata,
  PermissionRequest,
} from '@superone/shared/agent-types'
import { buildAgentErrorInfo, type AgentErrorCode } from '@superone/shared/agent-error'

export interface OpenCodeRuntimeConfig {
  binaryPath?: string
  serverUrl?: string
  serverPassword?: string
  env?: Record<string, string>
  startupTimeoutMs?: number
}

const OPENCODE_ERROR_NAMES: Record<string, AgentErrorCode> = {
  ProviderAuthError: 'authentication_failed',
  MessageOutputLengthError: 'max_output_tokens',
}

export function openCodeErrorInfo(error: unknown): AgentErrorInfo {
  const raw = openCodeErrorMessage(error)
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined
  const code = typeof name === 'string' ? OPENCODE_ERROR_NAMES[name] : undefined
  return buildAgentErrorInfo(raw, code ? { code } : {})
}

export interface OpenCodeAgentEventMapperOptions {
  messageId: string
  emit: (event: AgentEvent) => void
  now?: () => number
  contextWindowForModel?: (model: string) => number | undefined
}

export interface OpenCodeAgentEventApplyResult {
  textDelta: string | null
  terminal: boolean
}

export interface OpenCodeAgentEventMapper {
  start(providerSessionId?: string | null): void
  apply(event: Event | { type: string; properties?: Record<string, unknown> }): OpenCodeAgentEventApplyResult
  complete(interrupted?: boolean): void
  fail(error: string, errorInfo?: AgentErrorInfo): void
}

export function openCodeEventSessionId(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const properties = (event as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object') return undefined
  const sessionId = (properties as { sessionID?: unknown }).sessionID
  return typeof sessionId === 'string' ? sessionId : undefined
}

/** Stateful OpenCode Event -> AgentEvent projection shared by node hosts. */
export function createOpenCodeAgentEventMapper(options: OpenCodeAgentEventMapperOptions): OpenCodeAgentEventMapper {
  const now = options.now ?? Date.now
  const messageRoleById = new Map<string, 'user' | 'assistant'>()
  const partById = new Map<string, Part>()
  const emittedTextByPartId = new Map<string, string>()
  const completedToolIds = new Set<string>()
  const capturedUserMessageIds = new Set<string>()
  const pendingPermissions = new Set<string>()
  const pendingQuestions = new Set<string>()
  let latestMetadata: MessageMetadata | undefined
  let lastContextTokens = 0
  let started = false
  let terminal = false
  let currentTextDelta = ''

  const emit = (event: AgentEvent) => {
    if (event.type === 'content_delta' && event.delta.type === 'text') {
      currentTextDelta += event.delta.text
    }
    options.emit(event)
  }

  const roleForPart = (part: Part): 'user' | 'assistant' | undefined =>
    messageRoleById.get(part.messageID) ?? (part.type === 'tool' ? 'assistant' : undefined)

  const emitTextSnapshot = (part: Part) => {
    const text = textFromOpenCodePart(part)
    if (text === undefined || roleForPart(part) !== 'assistant') return
    const previous = emittedTextByPartId.get(part.id) ?? ''
    const latest = previous.length > text.length && previous.startsWith(text) ? previous : text
    const delta = latest.slice(commonPrefixLength(previous, latest))
    emittedTextByPartId.set(part.id, latest)
    if (!delta) return
    emit({
      type: 'content_delta',
      messageId: options.messageId,
      delta:
        part.type === 'reasoning'
          ? {
              type: 'thinking',
              thinking: delta,
              startedAt: part.time.start,
              endedAt: part.time.end,
            }
          : { type: 'text', text: delta },
    })
  }

  const emitTool = (part: Extract<Part, { type: 'tool' }>) => {
    const status = part.state.status === 'completed' || part.state.status === 'error' ? 'complete' : 'streaming'
    const input = 'input' in part.state ? JSON.stringify(part.state.input) : '{}'
    emit({
      type: 'content_delta',
      messageId: options.messageId,
      delta: {
        type: 'tool_use',
        toolName: openCodeToolName(part.tool),
        toolUseId: part.callID,
        input,
        status,
        ...('time' in part.state && part.state.time.start ? { startedAt: part.state.time.start } : {}),
      },
    })
    if (status !== 'complete' || completedToolIds.has(part.callID)) return
    completedToolIds.add(part.callID)
    const summary =
      part.state.status === 'completed' ? part.state.output : part.state.status === 'error' ? part.state.error : ''
    emit({
      type: 'content_delta',
      messageId: options.messageId,
      delta: {
        type: 'tool_result',
        toolUseId: part.callID,
        summary,
        isError: part.state.status === 'error',
      },
    })
  }

  const complete = (interrupted = false) => {
    if (terminal) return
    terminal = true
    emit({
      type: interrupted ? 'message_interrupted' : 'message_complete',
      messageId: options.messageId,
      ...(interrupted || !latestMetadata ? {} : { metadata: latestMetadata }),
    })
    emit({ type: 'status_change', status: 'idle' })
  }

  const fail = (error: string, errorInfo?: AgentErrorInfo) => {
    if (terminal) return
    terminal = true
    emit({
      type: 'message_error',
      messageId: options.messageId,
      error,
      errorInfo: errorInfo ?? buildAgentErrorInfo(error),
    })
    emit({ type: 'status_change', status: 'error' })
  }

  return {
    start(providerSessionId) {
      if (started) return
      started = true
      emit({
        type: 'message_start',
        message: {
          id: options.messageId,
          role: 'assistant',
          status: 'streaming',
          content: [],
          createdAt: new Date(now()).toISOString(),
          providerId: 'opencode',
        },
      })
      emit({ type: 'status_change', status: 'streaming' })
      if (providerSessionId) emit({ type: 'provider_session_id', providerSessionId })
      currentTextDelta = ''
    },

    apply(rawEvent) {
      currentTextDelta = ''
      const event = rawEvent as Event

      if (routeOpenCodeTodoEvent(event, emit)) {
        return { textDelta: null, terminal }
      }

      if (event.type === 'message.updated') {
        const info = event.properties.info
        messageRoleById.set(info.id, info.role)
        if (info.role === 'user' && !capturedUserMessageIds.has(info.id)) {
          capturedUserMessageIds.add(info.id)
          emit({
            type: 'checkpoint_captured',
            messageId: options.messageId,
            checkpointId: info.id,
            resumePointId: info.id,
          })
        }
        if (info.role === 'assistant') {
          latestMetadata = openCodeAssistantMetadata(info)
          const total =
            info.tokens.total ??
            info.tokens.input +
              info.tokens.output +
              info.tokens.reasoning +
              info.tokens.cache.read +
              info.tokens.cache.write
          const model = `${info.providerID}/${info.modelID}`
          emit({
            type: 'message_usage',
            messageId: options.messageId,
            inputTokens: info.tokens.input + info.tokens.cache.read + info.tokens.cache.write,
            outputTokens: info.tokens.output + info.tokens.reasoning,
            contextTokens: total,
            contextWindow: options.contextWindowForModel?.(model),
            costUsd: info.cost,
          })
          lastContextTokens = total
          for (const part of partById.values()) {
            if (part.messageID === info.id) emitTextSnapshot(part)
          }
        }
      } else if (event.type === 'message.removed') {
        messageRoleById.delete(event.properties.messageID)
      } else if (event.type === 'message.part.updated') {
        const part = event.properties.part
        partById.set(part.id, part)
        emitTextSnapshot(part)
        if (part.type === 'tool' && roleForPart(part) === 'assistant') emitTool(part)
      } else if (event.type === 'message.part.delta') {
        const part = partById.get(event.properties.partID)
        if (part && roleForPart(part) === 'assistant' && (part.type === 'text' || part.type === 'reasoning')) {
          const delta = event.properties.delta
          if (delta) {
            const nextText = `${emittedTextByPartId.get(part.id) ?? part.text}${delta}`
            emittedTextByPartId.set(part.id, nextText)
            partById.set(part.id, { ...part, text: nextText })
            emit({
              type: 'content_delta',
              messageId: options.messageId,
              delta:
                part.type === 'reasoning'
                  ? {
                      type: 'thinking',
                      thinking: delta,
                      startedAt: part.time.start,
                      endedAt: part.time.end,
                    }
                  : { type: 'text', text: delta },
            })
          }
        }
      } else if (event.type === 'permission.asked') {
        const request = mapOpenCodePermissionRequest({
          id: event.properties.id,
          permission: event.properties.permission,
          patterns: event.properties.patterns,
          metadata: event.properties.metadata,
          always: event.properties.always,
          toolUseId: event.properties.tool?.callID,
        })
        if (!pendingPermissions.has(request.requestId)) {
          pendingPermissions.add(request.requestId)
          emit({ type: 'permission_request', request })
        }
      } else if (event.type === 'permission.v2.asked') {
        const request = mapOpenCodePermissionRequest({
          id: event.properties.id,
          permission: event.properties.action,
          patterns: event.properties.resources,
          metadata: event.properties.metadata,
          always: event.properties.save,
          toolUseId: event.properties.source?.callID,
        })
        if (!pendingPermissions.has(request.requestId)) {
          pendingPermissions.add(request.requestId)
          emit({ type: 'permission_request', request })
        }
      } else if (event.type === 'permission.replied' || event.type === 'permission.v2.replied') {
        pendingPermissions.delete(event.properties.requestID)
        emit({
          type: 'interaction_resolved',
          interactionType: 'permission',
          requestId: event.properties.requestID,
          approved: event.properties.reply !== 'reject',
        })
      } else if (event.type === 'question.asked' || event.type === 'question.v2.asked') {
        const request = mapOpenCodeQuestionRequest({
          id: event.properties.id,
          questions: event.properties.questions,
        })
        if (!pendingQuestions.has(request.requestId)) {
          pendingQuestions.add(request.requestId)
          emit({ type: 'ask_user_question', request })
        }
      } else if (
        event.type === 'question.replied' ||
        event.type === 'question.rejected' ||
        event.type === 'question.v2.replied' ||
        event.type === 'question.v2.rejected'
      ) {
        pendingQuestions.delete(event.properties.requestID)
        emit({
          type: 'interaction_resolved',
          interactionType: 'question',
          requestId: event.properties.requestID,
        })
      } else if (event.type === 'session.status') {
        const status = event.properties.status
        if (status.type === 'busy') emit({ type: 'status_change', status: 'streaming' })
        if (status.type === 'retry') {
          emit({ type: 'status_change', status: 'streaming' })
          emit({
            type: 'api_retry',
            attempt: status.attempt,
            delayMs: Math.max(0, status.next - now()),
            message: status.message,
          })
        }
        if (status.type === 'idle') complete()
      } else if (event.type === 'session.idle') {
        complete()
      } else if (event.type === 'session.compacted') {
        emit({
          type: 'compact_boundary',
          trigger: 'auto',
          preTokens: lastContextTokens,
        })
        emit({
          type: 'status_indicator',
          indicator: null,
          compactResult: 'success',
        })
      } else if (event.type === 'session.error') {
        fail(openCodeErrorMessage(event.properties.error), openCodeErrorInfo(event.properties.error))
      } else if (event.type === 'session.updated') {
        const session = event.properties as unknown as {
          session?: { status?: string }
          status?: string
        }
        if (session.session?.status === 'idle' || session.status === 'idle') complete()
      }

      return { textDelta: currentTextDelta || null, terminal }
    },
    complete,
    fail,
  }
}
