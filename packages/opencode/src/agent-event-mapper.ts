import type { Event, Message, Part, Todo } from '@opencode-ai/sdk/v2'
import type {
  AgentEvent,
  AskUserQuestionRequest,
  MessageMetadata,
  PermissionRequest,
} from '@superone/shared/agent-types'

export interface OpenCodeRuntimeConfig {
  binaryPath?: string
  serverUrl?: string
  serverPassword?: string
  env?: Record<string, string>
  startupTimeoutMs?: number
}

export function readOpenCodeConfig(value: unknown): OpenCodeRuntimeConfig {
  if (!value || typeof value !== 'object') return {}
  const config = value as Record<string, unknown>
  return {
    binaryPath: typeof config.binaryPath === 'string' ? config.binaryPath : undefined,
    serverUrl: typeof config.serverUrl === 'string' ? config.serverUrl : undefined,
    serverPassword: typeof config.serverPassword === 'string' ? config.serverPassword : undefined,
    env: config.env && typeof config.env === 'object' ? config.env as Record<string, string> : undefined,
    startupTimeoutMs: typeof config.startupTimeoutMs === 'number' ? config.startupTimeoutMs : undefined,
  }
}

export function mapOpenCodePermissionRequest(input: {
  id: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always?: string[]
  toolUseId?: string
}): PermissionRequest {
  return {
    requestId: input.id,
    toolName: input.permission,
    toolUseId: input.toolUseId,
    input: input.metadata ?? {},
    allowAlwaysAllow: (input.always?.length ?? 0) > 0,
    supportsAlwaysPersist: (input.always?.length ?? 0) > 0,
    message: input.patterns.join('\n') || input.permission,
  }
}

export function mapOpenCodeQuestionRequest(input: {
  id: string
  questions: Array<{
    question: string
    header: string
    options?: Array<{ label: string; description?: string }>
    multiple?: boolean
  }>
}): AskUserQuestionRequest {
  return {
    requestId: input.id,
    questions: input.questions.map((question) => ({
      question: question.question,
      header: question.header,
      options: (question.options ?? []).map((option) => ({
        label: option.label,
        description: option.description ?? '',
      })),
      multiSelect: question.multiple ?? false,
    })),
  }
}

export function mapOpenCodeTodos(todos: Todo[]): Extract<AgentEvent, { type: 'todos_updated' }> {
  return {
    type: 'todos_updated',
    todos: todos.map((todo, index) => ({
      id: String(index + 1),
      subject: todo.content,
      description: '',
      status: todo.status === 'in_progress'
        ? 'in_progress'
        : todo.status === 'completed' || todo.status === 'cancelled' ? 'completed' : 'pending',
    })),
  }
}

export function routeOpenCodeTodoEvent(event: Event, emit: (event: AgentEvent) => void): boolean {
  if (event.type !== 'todo.updated') return false
  emit(mapOpenCodeTodos(event.properties.todos))
  return true
}

export function openCodeToolName(tool: string): string {
  const normalized = tool.toLowerCase()
  if (normalized === 'shell' || normalized === 'bash') return 'Bash'
  if (normalized === 'read') return 'Read'
  if (normalized === 'edit' || normalized === 'write') return normalized[0].toUpperCase() + normalized.slice(1)
  if (normalized === 'glob') return 'Glob'
  if (normalized === 'grep') return 'Grep'
  if (normalized === 'webfetch') return 'WebFetch'
  if (normalized === 'websearch') return 'WebSearch'
  if (normalized === 'task' || normalized === 'agent' || normalized === 'subtask') return 'Agent'
  if (normalized === 'todowrite') return 'TodoWrite'
  return tool
}

export function textFromOpenCodePart(part: Part): string | undefined {
  return part.type === 'text' || part.type === 'reasoning' ? part.text : undefined
}

export function commonPrefixLength(left: string, right: string): number {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1
  return index
}

export function openCodeErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'OpenCode session failed'
  const value = error as Record<string, unknown>
  const data = value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : null
  if (typeof data?.message === 'string' && data.message.trim()) return data.message
  if (typeof value.message === 'string' && value.message.trim()) return value.message
  if (typeof value.name === 'string' && value.name.trim()) return value.name
  try {
    return JSON.stringify(error)
  } catch {
    return 'OpenCode session failed'
  }
}

export function openCodeAssistantMetadata(info: Extract<Message, { role: 'assistant' }>): MessageMetadata {
  return {
    model: `${info.providerID}/${info.modelID}`,
    agent: info.agent,
    costUsd: info.cost,
    usage: {
      inputTokens: info.tokens.input,
      outputTokens: info.tokens.output,
      cacheReadInputTokens: info.tokens.cache.read,
      cacheCreationInputTokens: info.tokens.cache.write,
    },
    stopReason: info.finish ?? null,
    forkAnchorId: info.id,
  }
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
  fail(error: string): void
}

export function openCodeEventSessionId(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const properties = (event as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object') return undefined
  const sessionId = (properties as { sessionID?: unknown }).sessionID
  return typeof sessionId === 'string' ? sessionId : undefined
}

/** Stateful OpenCode Event -> AgentEvent projection shared by node hosts. */
export function createOpenCodeAgentEventMapper(
  options: OpenCodeAgentEventMapperOptions,
): OpenCodeAgentEventMapper {
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

  const roleForPart = (part: Part): 'user' | 'assistant' | undefined => (
    messageRoleById.get(part.messageID) ?? (part.type === 'tool' ? 'assistant' : undefined)
  )

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
      delta: part.type === 'reasoning'
        ? { type: 'thinking', thinking: delta, startedAt: part.time.start, endedAt: part.time.end }
        : { type: 'text', text: delta },
    })
  }

  const emitTool = (part: Extract<Part, { type: 'tool' }>) => {
    const status = part.state.status === 'completed' || part.state.status === 'error'
      ? 'complete'
      : 'streaming'
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
    const summary = part.state.status === 'completed'
      ? part.state.output
      : part.state.status === 'error' ? part.state.error : ''
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

  const fail = (error: string) => {
    if (terminal) return
    terminal = true
    emit({ type: 'message_error', messageId: options.messageId, error })
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
          const total = info.tokens.total
            ?? info.tokens.input + info.tokens.output + info.tokens.reasoning
              + info.tokens.cache.read + info.tokens.cache.write
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
              delta: part.type === 'reasoning'
                ? { type: 'thinking', thinking: delta, startedAt: part.time.start, endedAt: part.time.end }
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
        event.type === 'question.replied'
        || event.type === 'question.rejected'
        || event.type === 'question.v2.replied'
        || event.type === 'question.v2.rejected'
      ) {
        pendingQuestions.delete(event.properties.requestID)
        emit({ type: 'interaction_resolved', interactionType: 'question', requestId: event.properties.requestID })
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
        emit({ type: 'compact_boundary', trigger: 'auto', preTokens: lastContextTokens })
        emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
      } else if (event.type === 'session.error') {
        fail(openCodeErrorMessage(event.properties.error))
      } else if (event.type === 'session.updated') {
        const session = event.properties as unknown as { session?: { status?: string }; status?: string }
        if (session.session?.status === 'idle' || session.status === 'idle') complete()
      }

      return { textDelta: currentTextDelta || null, terminal }
    },
    complete,
    fail,
  }
}
