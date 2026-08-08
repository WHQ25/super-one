import { readFileSync } from 'node:fs'
import type { AgentEvent, ChatMessage, ContentBlock, SendMessageRequest, SessionInfo } from '@superone/shared/agent-types'
import { applySeqToMessage, isReplayedEventForMessage } from '@superone/shared/event-seq-utils'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { applyContentDelta } from '@superone/shared/content-delta'
import { resolveDeltaHomeMessageId, resolveTaskToolUseId } from '@superone/shared/subagent-routing'

export interface PersistedClaudeSessionState {
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  isWorktree: boolean
  gitBranch: string | null
  worktreePath: string | null
  provider: string
}

export interface TaskProgressEntry {
  description: string
  taskId?: string
  lastToolName?: string
  summary?: string
  totalTokens: number
  toolUses: number
  durationMs: number
  toolHistory: Array<{ toolName: string; description: string }>
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
  taskProgress: Record<string, TaskProgressEntry>
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
  return messages
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
    taskProgress: {},
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

export function extractResultText(raw: string): string | undefined {
  let lastText: string | undefined
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: { type?: string; message?: { content?: Array<{ type: string; text?: string }> } }
    try { record = JSON.parse(line) } catch { continue }
    if (record.type !== 'assistant' || !record.message?.content) continue
    for (const block of record.message.content) {
      if (block.type === 'text' && block.text) lastText = block.text
    }
  }
  return lastText
}

function summarizeToolInput(input: Record<string, unknown>, projectPath?: string): string {
  if (input.file_path) {
    let fp = String(input.file_path)
    if (projectPath) {
      const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/'
      if (fp.startsWith(prefix)) fp = fp.slice(prefix.length)
    }
    return fp
  }
  if (input.command) return String(input.command).slice(0, 120)
  if (input.pattern) return String(input.pattern)
  if (input.query) return String(input.query).slice(0, 120)
  if (input.url) return String(input.url)
  if (input.prompt) return String(input.prompt).slice(0, 120)
  if (input.description) return String(input.description).slice(0, 120)
  return ''
}

export function extractToolEntries(raw: string, projectPath?: string): Array<{ toolName: string; description: string }> {
  const entries: Array<{ toolName: string; description: string }> = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: { type?: string; message?: { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> } }
    try { record = JSON.parse(line) } catch { continue }
    if (record.type !== 'assistant' || !record.message?.content) continue
    for (const block of record.message.content) {
      if (block.type === 'tool_use' && block.name) {
        entries.push({ toolName: block.name, description: summarizeToolInput(block.input ?? {}, projectPath) })
      }
    }
  }
  return entries
}

export function readOutputFileResultText(outputFile: string): string | undefined {
  try {
    return extractResultText(readFileSync(outputFile, 'utf-8'))
  } catch { return undefined }
}

export function readOutputFile(outputFile: string, projectPath?: string): { resultText?: string; toolEntries: Array<{ toolName: string; description: string }> } {
  try {
    const raw = readFileSync(outputFile, 'utf-8')
    return { resultText: extractResultText(raw), toolEntries: extractToolEntries(raw, projectPath) }
  } catch { return { toolEntries: [] } }
}

export function patchAgentBlock(messages: ChatMessage[], tid: string, patch: Record<string, unknown>): ChatMessage[] {
  // Preserve object identity for unchanged messages so Session can derive dirty
  // ids via reference comparison after the reducer.
  let anyChanged = false
  const next = messages.map((msg) => {
    let blockChanged = false
    const content = msg.content.map((block) => {
      if (block.type === 'tool_use' && block.toolName === 'Agent' && block.toolUseId === tid) {
        blockChanged = true
        return { ...block, ...patch }
      }
      return block
    })
    if (!blockChanged) return msg
    anyChanged = true
    return { ...msg, content }
  })
  return anyChanged ? next : messages
}

export function applyClaudeEventToRuntime(
  runtime: ClaudeSessionRuntime,
  event: AgentEvent,
): ClaudeSessionRuntime {
  switch (event.type) {
    case 'message_start':
      return { ...runtime, messages: upsertMessage(runtime.messages, event.message) }
    case 'message_timestamp':
      return {
        ...runtime,
        messages: runtime.messages.map((message) =>
          message.id === event.messageId && message.createdAt !== event.timestamp
            ? { ...message, createdAt: event.timestamp }
            : message,
        ),
      }
    case 'content_delta': {
      const sourceMsg = runtime.messages.find((m) => m.id === event.messageId)
      if (sourceMsg && isReplayedEventForMessage(event, sourceMsg)) return runtime
      // Re-home a resumed sub-agent's delta under its original Agent block's
      // message so the persisted/mobile message tree stays correctly nested.
      // Seq tracking stays on the source message that owns the stream.
      const homeId = resolveDeltaHomeMessageId(runtime.messages, event.messageId, event.delta)
      return {
        ...runtime,
        messages: runtime.messages.map((message) => {
          if (message.id === homeId) {
            return {
              ...message,
              content: applyContentDelta(message.content, event.delta),
              ...(homeId === event.messageId ? applySeqToMessage(event) : {}),
            }
          }
          if (homeId !== event.messageId && message.id === event.messageId) {
            return { ...message, ...applySeqToMessage(event) }
          }
          return message
        }),
      }
    }
    case 'message_complete': {
      const usage = event.metadata?.usage
      const contextTokens = usage
        ? usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
        : runtime.contextTokens
      return {
        ...runtime,
        totalCostUsd: event.metadata?.costUsd ?? runtime.totalCostUsd,
        contextTokens: contextTokens > 0 ? contextTokens : runtime.contextTokens,
        messages: runtime.messages.map((message) => {
          if (message.id !== event.messageId) return message
          const metadata = { ...message.metadata, ...event.metadata }
          // Footer history reads consumedTokens; freeze from usage when still missing
          // (Grok often lands message_usage before complete, Claude after).
          if (!metadata.consumedTokens && metadata.usage) {
            const u = metadata.usage
            if (u.inputTokens > 0 || u.outputTokens > 0) {
              metadata.consumedTokens = { input: u.inputTokens, output: u.outputTokens }
            }
          }
          return {
            ...message,
            status: 'complete' as const,
            metadata,
          }
        }),
      }
    }
    case 'message_usage': {
      const hasTurnUsage = event.inputTokens > 0
        || event.outputTokens > 0
        || (event.cacheReadTokens ?? 0) > 0
      return {
        ...runtime,
        contextTokens: typeof event.contextTokens === 'number' && event.contextTokens > 0
          ? event.contextTokens
          : runtime.contextTokens,
        totalCostUsd: typeof event.costUsd === 'number' && event.costUsd >= 0
          ? event.costUsd
          : runtime.totalCostUsd,
        messages: hasTurnUsage
          ? runtime.messages.map((message) => (
              message.id !== event.messageId
                ? message
                : {
                    ...message,
                    metadata: {
                      ...message.metadata,
                      ...(event.model ? { model: event.model } : {}),
                      usage: {
                        inputTokens: event.inputTokens,
                        outputTokens: event.outputTokens,
                        cacheReadInputTokens: event.cacheReadTokens ?? 0,
                        cacheCreationInputTokens: 0,
                      },
                      // Persist footer tokens for history restore (Grok mid/late usage).
                      ...(event.inputTokens > 0 || event.outputTokens > 0
                        ? { consumedTokens: { input: event.inputTokens, output: event.outputTokens } }
                        : {}),
                    },
                  }
            ))
          : runtime.messages,
      }
    }
    case 'turn_summary': {
      // Attach onto the assistant bubble so history restores above the footer —
      // do not mint system markers here (those render as a separate row below).
      const summary = typeof event.summary === 'string' ? event.summary.trim() : ''
      if (!summary) return runtime
      let idx = -1
      if (event.messageId) {
        idx = runtime.messages.findIndex(
          (m) => m.id === event.messageId && m.role === 'assistant' && m.providerId !== 'system',
        )
      }
      if (idx < 0) {
        for (let i = runtime.messages.length - 1; i >= 0; i--) {
          const m = runtime.messages[i]
          if (m.role === 'assistant' && m.providerId !== 'system') {
            idx = i
            break
          }
        }
      }
      if (idx < 0) return runtime
      if (runtime.messages[idx].metadata?.turnSummary === summary) return runtime
      const messages = runtime.messages.slice()
      const target = messages[idx]
      messages[idx] = {
        ...target,
        metadata: {
          ...target.metadata,
          turnSummary: summary,
        },
      }
      return { ...runtime, messages }
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
      messages[targetIndex] = {
        ...messages[targetIndex],
        checkpointId: event.checkpointId,
        resumePointId: event.resumePointId,
      }
      return { ...runtime, messages }
    }
    case 'task_started': {
      if (!event.toolUseId) return runtime
      const tid = event.toolUseId
      const prev = runtime.taskProgress[tid]
      return {
        ...runtime,
        taskProgress: {
          ...runtime.taskProgress,
          [tid]: {
            description: event.description ?? '',
            taskId: event.taskId || prev?.taskId,
            lastToolName: prev?.lastToolName,
            summary: prev?.summary,
            totalTokens: prev?.totalTokens ?? 0,
            toolUses: prev?.toolUses ?? 0,
            durationMs: prev?.durationMs ?? 0,
            toolHistory: prev?.toolHistory ?? [],
          },
        },
      }
    }
    case 'task_progress': {
      if (!event.toolUseId) return runtime
      const tid = event.toolUseId
      const prev = runtime.taskProgress[tid]
      const toolHistory = [...(prev?.toolHistory ?? [])]
      if (prev && prev.description && prev.description !== event.description) {
        toolHistory.push({ toolName: prev.lastToolName ?? '', description: prev.description })
      }
      const progressSummary = event.summary ?? prev?.summary
      const usage = event.usage ?? { totalTokens: prev?.totalTokens ?? 0, toolUses: prev?.toolUses ?? 0, durationMs: prev?.durationMs ?? 0 }
      return {
        ...runtime,
        messages: patchAgentBlock(runtime.messages, tid, {
          taskUsage: { totalTokens: usage.totalTokens, toolUses: usage.toolUses, durationMs: usage.durationMs },
          taskToolHistory: toolHistory,
          taskSummary: progressSummary,
        }),
        taskProgress: {
          ...runtime.taskProgress,
          [tid]: {
            description: event.description ?? prev?.description ?? '',
            taskId: event.taskId || prev?.taskId,
            lastToolName: event.lastToolName,
            summary: progressSummary,
            totalTokens: usage.totalTokens,
            toolUses: usage.toolUses,
            durationMs: usage.durationMs,
            toolHistory,
          },
        },
      }
    }
    case 'task_notification': {
      // A resume notification carries the waker's toolUseId; map it back to the
      // original Agent block via the shared taskId so the patch lands correctly.
      const tid = resolveTaskToolUseId(runtime.taskProgress, event.toolUseId, event.taskId)
      if (!tid) return runtime
      const prev = runtime.taskProgress[tid]
      const finalSummary = event.summary || prev?.summary
      const usage = event.usage ?? { totalTokens: prev?.totalTokens ?? 0, toolUses: prev?.toolUses ?? 0, durationMs: prev?.durationMs ?? 0 }
      const finalToolHistory = prev?.toolHistory ?? []
      const taskResultText = event.outputFile ? readOutputFileResultText(event.outputFile) : undefined
      let msgs = patchAgentBlock(runtime.messages, tid, {
        taskUsage: { totalTokens: usage.totalTokens, toolUses: usage.toolUses, durationMs: usage.durationMs },
        taskToolHistory: finalToolHistory,
        taskSummary: finalSummary,
        ...(taskResultText ? { taskResultText } : {}),
      })
      if (event.outputFile) {
        // Preserve object identity for messages that do not own this tool_result,
        // so Session dirty tracking does not rewrite the entire transcript.
        let outputPathChanged = false
        const withOutputPath = msgs.map((msg) => {
          let blockChanged = false
          const content = msg.content.map((block) => {
            if (block.type === 'tool_result' && block.toolUseId === tid) {
              blockChanged = true
              return { ...block, outputPath: event.outputFile }
            }
            return block
          })
          if (!blockChanged) return msg
          outputPathChanged = true
          return { ...msg, content }
        })
        if (outputPathChanged) msgs = withOutputPath
      }
      return {
        ...runtime,
        messages: msgs,
        taskProgress: {
          ...runtime.taskProgress,
          [tid]: {
            ...(prev ?? { description: '', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] }),
            summary: finalSummary,
            totalTokens: usage.totalTokens,
            toolUses: usage.toolUses,
            durationMs: usage.durationMs,
          },
        },
      }
    }
    default:
      return runtime
  }
}

/**
 * Construct a ChatMessage for a user-submitted turn from the IPC SendMessageRequest.
 * Agent-agnostic: used by both Claude and Codex paths. Adding a new agent should
 * NOT require a separate user-message builder — extend SendMessageRequest instead.
 */
export function buildUserMessage(
  request: SendMessageRequest,
  providerId: 'local' | 'remote',
): ChatMessage {
  const content: ContentBlock[] = request.userMessageContent ?? [
    ...(request.images ?? []).map((attachment) =>
      attachment.mimeType === 'application/pdf'
        ? { type: 'document' as const, name: attachment.name }
        : { type: 'image' as const, name: attachment.name },
    ),
    { type: 'text' as const, text: request.content },
  ]

  const metadata = (request.source && request.source !== 'user') || request.collaboration
    ? {
        ...(request.source && request.source !== 'user' ? { source: request.source } : {}),
        ...(request.collaboration ? { collaboration: request.collaboration } : {}),
      }
    : undefined

  return {
    id: request.clientMessageId ?? `user_${Date.now()}`,
    role: 'user',
    status: 'complete',
    content,
    attachments: request.images?.length ? request.images : undefined,
    contexts: request.contexts && request.contexts.length > 0 ? request.contexts : undefined,
    userSelections: request.userSelections && request.userSelections.length > 0 ? request.userSelections : undefined,
    createdAt: new Date().toISOString(),
    providerId,
    ...(metadata ? { metadata } : {}),
  }
}

/** @deprecated Use buildUserMessage. Kept as alias for compatibility. */
export const buildClaudeUserMessage = buildUserMessage

export function extractClaudeTitle(messages: ChatMessage[]): string | undefined {
  const text = messages.find((message) => message.role === 'user')?.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ') ?? ''
  const cleaned = stripMiniAppMarkup(text)
  return cleaned.slice(0, 100) || undefined
}
