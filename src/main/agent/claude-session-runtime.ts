import type { AgentEvent, ChatMessage, ContentBlock, SendMessageRequest, SessionInfo } from '../../shared/agent-types'

export interface PersistedClaudeSessionState {
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  isWorktree: boolean
  gitBranch: string | null
  worktreePath: string | null
  provider: string
}

export interface ClaudeSessionRuntime {
  projectPath: string
  sessionId: string | null
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  session: SessionInfo | null
  gitBranch: string | null
  worktreePath: string | null
}

function applyDelta(content: ContentBlock[], delta: ContentBlock): ContentBlock[] {
  if (delta.type === 'text') {
    const last = content[content.length - 1]
    if (last?.type === 'text') {
      return [...content.slice(0, -1), { type: 'text', text: last.text + delta.text }]
    }
  }
  if (delta.type === 'thinking') {
    const last = content[content.length - 1]
    if (last?.type === 'thinking') {
      return [...content.slice(0, -1), { type: 'thinking', thinking: last.thinking + delta.thinking }]
    }
  }
  if (delta.type === 'tool_use') {
    const idx = content.findIndex((block) => block.type === 'tool_use' && block.toolUseId === delta.toolUseId)
    if (idx !== -1) {
      const existing = content[idx]
      const preserved = existing.type === 'tool_use'
        ? {
            startedAt: existing.startedAt,
            elapsedSeconds: existing.elapsedSeconds,
            ...(!delta.status && existing.status ? { status: existing.status } : {}),
          }
        : {}
      return content.map((block, index) => (index === idx ? { ...preserved, ...delta } : block))
    }
    return [...content, { ...delta, startedAt: Date.now() }]
  }
  if (delta.type === 'tool_result') {
    const updated = content.map((block) =>
      block.type === 'tool_use' && block.toolUseId === delta.toolUseId
        ? { ...block, status: 'complete' as const }
        : block,
    )
    return [...updated, delta]
  }
  return [...content, delta]
}

function findCheckpointTarget(messages: ChatMessage[], assistantMessageId: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id === assistantMessageId) {
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'user') return j
      }
      break
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return -1
}

function mergeMessages(savedMessages: ChatMessage[], runtimeMessages: ChatMessage[]): ChatMessage[] {
  const runtimeById = new Map(runtimeMessages.map((message) => [message.id, message]))
  const merged = savedMessages.map((message) => runtimeById.get(message.id) ?? message)
  const seen = new Set(merged.map((message) => message.id))
  for (const message of runtimeMessages) {
    if (seen.has(message.id)) continue
    merged.push(message)
    seen.add(message.id)
  }
  return merged
}

function upsertMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const idx = messages.findIndex((message) => message.id === next.id)
  if (idx === -1) return [...messages, next]
  return messages.map((message, index) => (index === idx ? next : message))
}

export function createClaudeRuntime(
  projectPath: string,
  sessionId: string | null,
  overrides: Partial<ClaudeSessionRuntime> = {},
): ClaudeSessionRuntime {
  return {
    projectPath,
    sessionId,
    messages: [],
    totalCostUsd: 0,
    contextTokens: 0,
    session: null,
    gitBranch: null,
    worktreePath: null,
    ...overrides,
  }
}

export function hydrateClaudeRuntime(
  projectPath: string,
  sessionId: string,
  saved: PersistedClaudeSessionState | null,
  cwd?: string,
): ClaudeSessionRuntime {
  return createClaudeRuntime(projectPath, sessionId, {
    messages: saved?.messages ?? [],
    totalCostUsd: saved?.totalCostUsd ?? 0,
    contextTokens: saved?.contextTokens ?? 0,
    gitBranch: saved?.gitBranch ?? null,
    worktreePath: saved?.worktreePath ?? (cwd && cwd !== projectPath ? cwd : null),
  })
}

export function mergeClaudeRuntimes(
  base: ClaudeSessionRuntime,
  incoming: ClaudeSessionRuntime,
): ClaudeSessionRuntime {
  return {
    ...base,
    ...incoming,
    sessionId: incoming.sessionId ?? base.sessionId,
    messages: mergeMessages(base.messages, incoming.messages),
    totalCostUsd: Math.max(base.totalCostUsd, incoming.totalCostUsd),
    contextTokens: Math.max(base.contextTokens, incoming.contextTokens),
    session: incoming.session ?? base.session,
    gitBranch: incoming.gitBranch ?? base.gitBranch,
    worktreePath: incoming.worktreePath ?? base.worktreePath,
  }
}

export function syncClaudeRuntimeLocation(
  runtime: ClaudeSessionRuntime,
  projectPath: string,
  gitBranch?: string | null,
  worktreePath?: string | null,
  cwd?: string,
): ClaudeSessionRuntime {
  return {
    ...runtime,
    gitBranch: gitBranch ?? runtime.gitBranch,
    worktreePath: worktreePath ?? runtime.worktreePath ?? (cwd && cwd !== projectPath ? cwd : null),
  }
}

export function applyClaudeEventToRuntime(
  runtime: ClaudeSessionRuntime,
  event: AgentEvent,
): ClaudeSessionRuntime {
  switch (event.type) {
    case 'message_start':
      return { ...runtime, messages: upsertMessage(runtime.messages, event.message) }
    case 'content_delta':
      return {
        ...runtime,
        messages: runtime.messages.map((message) => (
          message.id !== event.messageId
            ? message
            : { ...message, content: applyDelta(message.content, event.delta) }
        )),
      }
    case 'message_complete': {
      const usage = event.metadata?.usage
      const contextTokens = usage
        ? usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
        : runtime.contextTokens
      return {
        ...runtime,
        totalCostUsd: runtime.totalCostUsd + (event.metadata?.costUsd ?? 0),
        contextTokens: contextTokens > 0 ? contextTokens : runtime.contextTokens,
        messages: runtime.messages.map((message) => (
          message.id !== event.messageId
            ? message
            : {
                ...message,
                status: 'complete' as const,
                metadata: { ...message.metadata, ...event.metadata },
              }
        )),
      }
    }
    case 'message_interrupted':
      return {
        ...runtime,
        messages: runtime.messages.map((message) => (
          message.id !== event.messageId
            ? message
            : {
                ...message,
                status: 'interrupted' as const,
                metadata: event.metadata ? { ...message.metadata, ...event.metadata } : message.metadata,
              }
        )),
      }
    case 'message_error':
      return {
        ...runtime,
        messages: runtime.messages.map((message) => (
          message.id !== event.messageId
            ? message
            : {
                ...message,
                status: 'error' as const,
                content: [...message.content, { type: 'text' as const, text: `Error: ${event.error}` }],
              }
        )),
      }
    case 'session_init':
      return {
        ...runtime,
        sessionId: event.session.sessionId || runtime.sessionId,
        session: event.session,
      }
    case 'checkpoint_captured': {
      const messages = [...runtime.messages]
      const targetIndex = findCheckpointTarget(messages, event.messageId)
      if (targetIndex === -1) return runtime
      if (messages[targetIndex].checkpointId) return runtime
      messages[targetIndex] = {
        ...messages[targetIndex],
        checkpointId: event.checkpointId,
        resumePointId: event.resumePointId,
      }
      return { ...runtime, messages }
    }
    default:
      return runtime
  }
}

export function buildClaudeUserMessage(
  request: SendMessageRequest,
  providerId: 'local' | 'remote',
): ChatMessage {
  const content: ContentBlock[] = [
    ...(request.images ?? []).map((attachment) =>
      attachment.mimeType === 'application/pdf'
        ? { type: 'document' as const, name: attachment.name }
        : { type: 'image' as const, name: attachment.name },
    ),
    { type: 'text' as const, text: request.content },
  ]

  return {
    id: request.clientMessageId ?? `user_${Date.now()}`,
    role: 'user',
    status: 'complete',
    content,
    attachments: request.images?.length ? request.images : undefined,
    createdAt: new Date().toISOString(),
    providerId,
  }
}

export function extractClaudeTitle(messages: ChatMessage[]): string | undefined {
  return messages.find((message) => message.role === 'user')?.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .slice(0, 100) || undefined
}
