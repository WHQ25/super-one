import type { AgentErrorInfo, ChatMessage } from '@superone/shared/agent-types'

export interface TurnTokenCounts {
  input: number
  output: number
}

export const ZERO_TURN_TOKENS: TurnTokenCounts = { input: 0, output: 0 }

const TERMINAL_REASON_LABELS: Record<string, string> = {
  max_turns: 'Max turns',
  aborted_tools: 'Aborted',
  blocking_limit: 'Blocked',
  api_error: 'API Error',
}

export function formatTerminalReason(reason: string): string {
  return TERMINAL_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
}

export interface TurnFooterInput {
  message: ChatMessage
  /** The turn is the live one AND the session is still producing it. */
  isStreaming: boolean
  /** Live counters from session state; only read while streaming. */
  streamingTokens: TurnTokenCounts
  /**
   * Last non-zero live counters. A turn that settles before its usage metadata
   * lands would otherwise drop back to zero for the frame in between.
   */
  frozenTokens: TurnTokenCounts
  /** Elapsed ms from the caller's ticker; used while streaming and as a fallback. */
  elapsedMs: number
}

export interface TurnFooterModel {
  durationMs?: number
  /** `12s` / `3m 4s`, empty when there is no duration to show. */
  durationLabel: string
  tokenInput: number
  tokenOutput: number
  hasTokens: boolean
  showDuration: boolean
  showError: boolean
  errorInfo?: AgentErrorInfo
  showTerminalReason: boolean
  terminalReason?: string
  /** Nothing in the shared slice is worth a row. Hosts may still add their own. */
  isEmpty: boolean
}

/**
 * Which duration / token / failure facts a finished or live turn should show.
 *
 * The token fallback chain is the reason this is shared rather than written per
 * host: history, ACP and Codex each record a turn's spend in a different place,
 * and a surface that reads only one of them silently shows `0` for the others.
 */
export function turnFooterModel({
  message,
  isStreaming,
  streamingTokens,
  frozenTokens,
  elapsedMs,
}: TurnFooterInput): TurnFooterModel {
  const durationMs = isStreaming
    ? elapsedMs
    : (message.metadata?.durationMs ?? (elapsedMs || undefined))

  const consumed = message.metadata?.consumedTokens
  const metaUsage = message.metadata?.usage
  const codexUsage = message.metadata?.codex?.usage
  const hasMetaUsage = Boolean(metaUsage && (metaUsage.inputTokens > 0 || metaUsage.outputTokens > 0))

  const tokenInput = isStreaming
    ? streamingTokens.input
    : (consumed?.input
      ?? (hasMetaUsage ? metaUsage!.inputTokens : undefined)
      ?? (codexUsage ? Math.max(0, codexUsage.lastInputTokens - codexUsage.lastCachedInputTokens) : undefined)
      ?? frozenTokens.input)
  const tokenOutput = isStreaming
    ? streamingTokens.output
    : (consumed?.output
      ?? (hasMetaUsage ? metaUsage!.outputTokens : undefined)
      ?? codexUsage?.lastOutputTokens
      ?? frozenTokens.output)

  // A live turn shows its clock as soon as it means anything; a settled one only
  // when it ran long enough that the number is worth the row.
  const showDuration = Boolean(durationMs && (isStreaming ? durationMs >= 1000 : durationMs >= 20000))
  const hasTokens = tokenInput > 0 || tokenOutput > 0

  const errorInfo = message.metadata?.errorInfo
  const showError = !isStreaming && Boolean(errorInfo)
  const terminalReason = message.metadata?.terminalReason
  // The error badge already names the failure; the bare terminal-reason chip
  // would just repeat it in developer vocabulary.
  const showTerminalReason = !isStreaming
    && !showError
    && Boolean(terminalReason)
    && terminalReason !== 'completed'
    && message.status !== 'interrupted'

  const seconds = durationMs ? Math.round(durationMs / 1000) : 0
  const durationLabel = !showDuration
    ? ''
    : seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  return {
    durationMs,
    durationLabel,
    tokenInput,
    tokenOutput,
    hasTokens,
    showDuration,
    showError,
    ...(errorInfo ? { errorInfo } : {}),
    showTerminalReason,
    ...(terminalReason ? { terminalReason } : {}),
    isEmpty: !showDuration && !hasTokens && !showError && !showTerminalReason,
  }
}

export type PendingTurnPhase = 'creating' | 'sending'

/** UI-only assistant shell: reserves the real message footer before message_start. */
export function pendingTurnMessage(user: ChatMessage): ChatMessage {
  return {
    id: `pending-reply:${user.id}`, role: 'assistant', status: 'streaming',
    providerId: user.providerId, createdAt: user.createdAt, content: [],
  }
}

export type { ProjectedApiRetry as TurnRetryInfo } from '../protocol'

/** Never put a new request's session status on the preceding answer. */
export function sessionFooterTarget(messages: readonly ChatMessage[], lastAssistantId: string | undefined) {
  const userIndex = messages.findLastIndex(message => message.role === 'user')
  const assistantIndex = messages.findLastIndex(message => message.id === lastAssistantId)
  const steersCurrentTurn = messages[userIndex]?.metadata?.transcriptBoundary?.messageId === lastAssistantId
  if (assistantIndex >= 0 && (assistantIndex > userIndex || steersCurrentTurn)) {
    return { message: messages[assistantIndex], placeholder: false }
  }
  return {
    message: pendingTurnMessage(messages[userIndex] ?? {
      id: 'session-status', role: 'user', status: 'complete', providerId: 'local',
      createdAt: new Date().toISOString(), content: [],
    }),
    placeholder: true,
  }
}

export function turnHasOutput(message: ChatMessage): boolean {
  return message.content.some(block => block.type === 'text'
    ? block.text.trim().length > 0
    : block.type === 'thinking' ? block.thinking.trim().length > 0 : true)
}

export function mcpStartupProgress(message: ChatMessage, isStreaming: boolean) {
  const servers = message.metadata?.codex?.mcpStartup ?? []
  return isStreaming && !turnHasOutput(message) && servers.some(server => server.status === 'starting')
    ? { ready: servers.filter(server => server.status === 'ready').length, total: servers.length }
    : null
}
