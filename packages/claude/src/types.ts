/**
 * Host-facing contracts for the Claude Agent SDK turn core.
 * Electron-free: desktop and CLI both adapt these to their permission / event paths.
 */

import type { SessionTurnEvent } from '@superone/shared/environment'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

export type ClaudePermissionDecision = 'allow' | 'deny'

export interface ClaudePermissionRequest {
  /** Stable id for this prompt (SDK requestId or toolUseID). */
  interactionId: string
  toolName: string
  toolUseId?: string
  input?: Record<string, unknown>
}

export type ClaudePermissionHandler = (
  request: ClaudePermissionRequest,
) => Promise<ClaudePermissionDecision>

/**
 * Injectable query factory for tests. Production uses SDK `query()`.
 * Must return an AsyncIterable of SDK messages (Query is an AsyncGenerator).
 */
export type ClaudeQueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}) => Query | AsyncIterable<SDKMessage>

export interface RunClaudeSdkTurnOptions {
  /**
   * Path to the Claude Code executable (`pathToClaudeCodeExecutable`).
   * Prefer omitting: the Agent SDK ships a platform binary via optional
   * dependencies; we resolve it with {@link resolveSdkClaudeBinary}.
   * Host/lab overrides (SUPERONE_CLAUDE_BINARY, managed install) pass an
   * explicit path when they need a non-SDK binary.
   */
  binaryPath?: string | null
  prompt: string
  cwd: string
  /** Prior Claude Code session id for SDK `resume`. */
  sessionId?: string | null
  model?: string
  /**
   * Subprocess env. When set, the SDK replaces the child env entirely —
   * callers should spread process.env if inheritance is required.
   */
  env?: NodeJS.ProcessEnv
  /**
   * Blocking permission. When absent, canUseTool denies fail-closed.
   * Hosts map this to SessionRuntime.onPermission / desktop permission UI.
   */
  onPermission?: ClaudePermissionHandler
  /**
   * Structured turn stream (text / tool / permission / status).
   * Prefer this over onDelta; do not dual-path the same text.
   */
  onEvent?: (event: SessionTurnEvent) => void
  /**
   * Lossless Claude SDK -> AgentEvent path. When provided it takes precedence
   * over onEvent so hosts do not receive duplicate text/tool events.
   */
  onAgentEvent?: (event: AgentEvent) => void
  /**
   * Legacy text-only path used only when both event callbacks are absent.
   */
  onDelta?: (text: string) => void
  signal: AbortSignal
  /** Stable default assistant text block id (tests inject). */
  defaultTextBlockId?: string
  /** Stable assistant message id used by AgentEvents for this turn. */
  messageId?: string
  /** Injectable SDK entry (tests). Default: real `query` from agent SDK. */
  queryFn?: ClaudeQueryFn
  /** Extra Options overrides (MCP, systemPrompt, permissionMode, …). */
  options?: Partial<Options>
}

export interface ClaudeSdkTurnResult {
  finalText: string
  sessionId: string | null
}
