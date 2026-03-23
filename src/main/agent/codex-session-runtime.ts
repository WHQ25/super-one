import type { AgentEvent, ChatMessage, CodexRunResult, CodexThreadItem, CodexUsageInfo } from '../../shared/agent-types'
import { buildClaudeUserMessage, extractClaudeTitle, type PersistedClaudeSessionState } from './claude-session-runtime'

export type PersistedCodexSessionState = PersistedClaudeSessionState

export interface CodexSessionRuntime {
  projectPath: string
  sessionId: string
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  gitBranch: string | null
  worktreePath: string | null
  streamingTokensByMessageId: Record<string, { input: number; output: number }>
  lastUsageByMessageId: Record<string, CodexUsageInfo | null>
}

function upsertCodexItem(items: CodexThreadItem[], next: CodexThreadItem): CodexThreadItem[] {
  const idx = items.findIndex((item) => item.id === next.id)
  if (idx === -1) return [...items, next]
  const cloned = [...items]
  cloned[idx] = next
  return cloned
}

function hasValidCodexUsageSnapshot(usage: CodexUsageInfo | null): usage is CodexUsageInfo {
  return Boolean(
    usage
      && Number.isFinite(usage.totalInputTokens)
      && Number.isFinite(usage.totalCachedInputTokens)
      && Number.isFinite(usage.totalOutputTokens)
      && Number.isFinite(usage.lastInputTokens)
      && Number.isFinite(usage.lastCachedInputTokens)
      && Number.isFinite(usage.lastOutputTokens),
  )
}

function isSameCodexUsageSnapshot(a: CodexUsageInfo | null, b: CodexUsageInfo | null): boolean {
  return Boolean(
    a
      && b
      && a.totalInputTokens === b.totalInputTokens
      && a.totalCachedInputTokens === b.totalCachedInputTokens
      && a.totalOutputTokens === b.totalOutputTokens
      && a.lastInputTokens === b.lastInputTokens
      && a.lastCachedInputTokens === b.lastCachedInputTokens
      && a.lastOutputTokens === b.lastOutputTokens,
  )
}

function getCodexUsageStepTokens(usage: CodexUsageInfo): { input: number; output: number } {
  return {
    input: Math.max(0, usage.lastInputTokens - usage.lastCachedInputTokens),
    output: usage.lastOutputTokens,
  }
}

function accumulateCodexFooterTokens(
  current: { input: number; output: number },
  usage: CodexUsageInfo,
  previous: CodexUsageInfo | null,
): { input: number; output: number } {
  if (!hasValidCodexUsageSnapshot(usage) || isSameCodexUsageSnapshot(usage, previous)) {
    return current
  }
  const step = getCodexUsageStepTokens(usage)
  return {
    input: current.input + step.input,
    output: current.output + step.output,
  }
}

function getCodexContextTokens(usage: CodexUsageInfo): number {
  return usage.lastInputTokens
}

function upsertMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const idx = messages.findIndex((message) => message.id === next.id)
  if (idx === -1) return [...messages, next]
  return messages.map((message, index) => (index === idx ? next : message))
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

export function createCodexRuntime(
  projectPath: string,
  sessionId: string,
  overrides: Partial<CodexSessionRuntime> = {},
): CodexSessionRuntime {
  return {
    projectPath,
    sessionId,
    messages: [],
    totalCostUsd: 0,
    contextTokens: 0,
    gitBranch: null,
    worktreePath: null,
    streamingTokensByMessageId: {},
    lastUsageByMessageId: {},
    ...overrides,
  }
}

export function hydrateCodexRuntime(
  projectPath: string,
  sessionId: string,
  saved: PersistedCodexSessionState | null,
  cwd?: string,
): CodexSessionRuntime {
  return createCodexRuntime(projectPath, sessionId, {
    messages: saved?.messages ?? [],
    totalCostUsd: saved?.totalCostUsd ?? 0,
    contextTokens: saved?.contextTokens ?? 0,
    gitBranch: saved?.gitBranch ?? null,
    worktreePath: saved?.worktreePath ?? (cwd && cwd !== projectPath ? cwd : null),
  })
}

export function syncCodexRuntimeLocation(
  runtime: CodexSessionRuntime,
  projectPath: string,
  gitBranch?: string | null,
  worktreePath?: string | null,
  cwd?: string,
): CodexSessionRuntime {
  return {
    ...runtime,
    projectPath,
    gitBranch: gitBranch ?? runtime.gitBranch,
    worktreePath: worktreePath ?? runtime.worktreePath ?? (cwd && cwd !== projectPath ? cwd : null),
  }
}

export function mergeCodexRuntimes(base: CodexSessionRuntime, incoming: CodexSessionRuntime): CodexSessionRuntime {
  return {
    ...base,
    ...incoming,
    messages: mergeMessages(base.messages, incoming.messages),
    totalCostUsd: Math.max(base.totalCostUsd, incoming.totalCostUsd),
    contextTokens: Math.max(base.contextTokens, incoming.contextTokens),
    gitBranch: incoming.gitBranch ?? base.gitBranch,
    worktreePath: incoming.worktreePath ?? base.worktreePath,
    streamingTokensByMessageId: { ...base.streamingTokensByMessageId, ...incoming.streamingTokensByMessageId },
    lastUsageByMessageId: { ...base.lastUsageByMessageId, ...incoming.lastUsageByMessageId },
  }
}

export function appendCodexTurnMessages(
  runtime: CodexSessionRuntime,
  args: {
    userMessageId: string
    userText: string
    assistantMessageId: string
    providerId: 'local' | 'remote'
    images?: Array<{ mimeType: string; base64: string; name: string }>
  },
): CodexSessionRuntime {
  const userMessage = buildClaudeUserMessage({
    content: args.userText,
    images: args.images,
    clientMessageId: args.userMessageId,
  }, args.providerId)
  const assistantMessage: ChatMessage = {
    id: args.assistantMessageId,
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: new Date().toISOString(),
    providerId: 'codex',
  }
  return {
    ...runtime,
    messages: upsertMessage(upsertMessage(runtime.messages, userMessage), assistantMessage),
  }
}

export function withCodexTurnMessages(
  runtime: CodexSessionRuntime,
  userMessage: ChatMessage,
  assistantMessage: ChatMessage,
): CodexSessionRuntime {
  return {
    ...runtime,
    messages: upsertMessage(upsertMessage(runtime.messages, userMessage), assistantMessage),
  }
}

export function buildCodexAssistantMessage(messageId: string): ChatMessage {
  return {
    id: messageId,
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: new Date().toISOString(),
    providerId: 'codex',
  }
}

export function removeCodexAssistantMessage(runtime: CodexSessionRuntime, messageId: string): CodexSessionRuntime {
  if (!runtime.messages.some((message) => message.id === messageId)) return runtime
  const { [messageId]: _, ...restStreaming } = runtime.streamingTokensByMessageId
  const { [messageId]: __, ...restUsage } = runtime.lastUsageByMessageId
  return {
    ...runtime,
    messages: runtime.messages.filter((message) => message.id !== messageId),
    streamingTokensByMessageId: restStreaming,
    lastUsageByMessageId: restUsage,
  }
}

export function applyCodexEventToRuntime(runtime: CodexSessionRuntime, event: AgentEvent): CodexSessionRuntime {
  switch (event.type) {
    case 'message_usage': {
      if (!event.codexUsage) return runtime
      const previous = runtime.lastUsageByMessageId[event.messageId] ?? null
      const current = runtime.streamingTokensByMessageId[event.messageId] ?? { input: 0, output: 0 }
      const nextStreamingTokens = accumulateCodexFooterTokens(current, event.codexUsage, previous)
      const nextMessages = runtime.messages.map((message) => {
        if (message.id !== event.messageId) return message
        const prevCodex = message.metadata?.codex ?? { threadId: null, usage: null, items: [] }
        return {
          ...message,
          metadata: {
            ...message.metadata,
            codex: {
              ...prevCodex,
              usage: event.codexUsage,
            },
          },
        }
      })
      return {
        ...runtime,
        messages: nextMessages,
        contextTokens: (() => {
          const total = getCodexContextTokens(event.codexUsage)
          return total > 0 ? total : runtime.contextTokens
        })(),
        streamingTokensByMessageId: {
          ...runtime.streamingTokensByMessageId,
          [event.messageId]: nextStreamingTokens,
        },
        lastUsageByMessageId: {
          ...runtime.lastUsageByMessageId,
          [event.messageId]: event.codexUsage,
        },
      }
    }
    case 'codex_thread_started':
      return {
        ...runtime,
        messages: runtime.messages.map((message) => {
          if (message.id !== event.messageId) return message
          const prevCodex = message.metadata?.codex ?? { threadId: null, usage: null, items: [] }
          return {
            ...message,
            metadata: {
              ...message.metadata,
              codex: {
                ...prevCodex,
                threadId: event.threadId,
              },
            },
          }
        }),
      }
    case 'codex_item_delta':
      return {
        ...runtime,
        messages: runtime.messages.map((message) => {
          if (message.id !== event.messageId) return message
          const prevCodex = message.metadata?.codex ?? { threadId: null, usage: null, items: [] }
          return {
            ...message,
            metadata: {
              ...message.metadata,
              codex: {
                ...prevCodex,
                items: upsertCodexItem(prevCodex.items, event.item),
              },
            },
          }
        }),
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

export function finalizeCodexAssistantMessage(
  runtime: CodexSessionRuntime,
  args: {
    messageId: string
    status: 'complete' | 'interrupted' | 'error'
    text: string
    result?: CodexRunResult
    durationMs?: number
  },
): CodexSessionRuntime {
  const consumedTokens = runtime.streamingTokensByMessageId[args.messageId]
  const nextMessages = runtime.messages.map((message) => {
    if (message.id !== args.messageId) return message
    if (args.status !== 'complete' || !args.result) {
      return {
        ...message,
        status: args.status,
        content: [{ type: 'text' as const, text: args.text }],
      }
    }
    return {
      ...message,
      status: 'complete' as const,
      content: [{ type: 'text' as const, text: args.text }],
      metadata: args.result.usage ? {
        durationMs: args.durationMs,
        usage: {
          inputTokens: args.result.usage.lastInputTokens,
          outputTokens: args.result.usage.lastOutputTokens,
          cacheReadInputTokens: args.result.usage.lastCachedInputTokens,
          cacheCreationInputTokens: 0,
        },
        ...(consumedTokens && (consumedTokens.input > 0 || consumedTokens.output > 0) ? { consumedTokens } : {}),
        codex: {
          threadId: args.result.threadId,
          usage: args.result.usage,
          items: args.result.items,
        },
      } : {
        durationMs: args.durationMs,
        codex: {
          threadId: args.result.threadId,
          usage: null,
          items: args.result.items,
        },
      },
    }
  })
  const { [args.messageId]: _, ...restStreaming } = runtime.streamingTokensByMessageId
  const { [args.messageId]: __, ...restUsage } = runtime.lastUsageByMessageId
  return {
    ...runtime,
    messages: nextMessages,
    contextTokens: args.result?.usage
      ? (() => {
          const total = getCodexContextTokens(args.result.usage)
          return total > 0 ? total : runtime.contextTokens
        })()
      : runtime.contextTokens,
    streamingTokensByMessageId: restStreaming,
    lastUsageByMessageId: restUsage,
  }
}

export { buildClaudeUserMessage as buildCodexUserMessage, extractClaudeTitle as extractCodexTitle }
