import type { Event, Message, Part } from '@opencode-ai/sdk/v2'
import type {
  AgentEvent,
  AskUserQuestionRequest,
  MessageMetadata,
  PermissionRequest,
} from '@superone/shared/agent-types'
import type { OpenCodeRuntimeConfig } from './opencode-runtime'

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

export function routeOpenCodeTodoEvent(event: Event, emit: (event: AgentEvent) => void): boolean {
  if (event.type !== 'todo.updated') return false
  emit({
    type: 'todos_updated',
    todos: event.properties.todos.map((todo, index) => ({
      id: String(index + 1),
      subject: todo.content,
      description: '',
      status: todo.status === 'in_progress'
        ? 'in_progress'
        : todo.status === 'completed' || todo.status === 'cancelled' ? 'completed' : 'pending',
    })),
  })
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
    costUsd: info.cost,
    usage: {
      inputTokens: info.tokens.input,
      outputTokens: info.tokens.output,
      cacheReadInputTokens: info.tokens.cache.read,
      cacheCreationInputTokens: info.tokens.cache.write,
    },
    stopReason: info.finish ?? null,
  }
}
