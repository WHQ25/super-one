/**
 * Node `session.rewind` dispatch. OpenCode keeps its native handler. The other
 * harnesses share transcript truncation; file and conversation restore stay on
 * the harness that owns the checkpoint.
 */
import type { ChatMessage, RewindFilesResult } from '@superone/shared/agent-types'
import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import type { HarnessOperationHost, NodeSessionRecord, TurnRunner } from '@superone/runtime/session'
import { grokPromptIndexForCheckpoint, type GrokRewindMode, type GrokRewindRequest } from '@superone/acp/grok-rewind'

export const REWIND_METHODS = new Set(['session.previewRewind', 'session.rewind', 'session.truncateAtCheckpoint'])

const CURSOR_REWIND_ERROR = 'Cursor SDK does not expose host rewindFiles; use SuperOne transcript fork instead.'

export function truncateBeforeCheckpoint(messages: ChatMessage[], checkpointId: string): ChatMessage[] | null {
  const index = messages.findIndex((message) => message.checkpointId === checkpointId)
  if (index < 0) return null
  return messages.slice(0, index)
}

/** The assistant turn Codex must drop, exclusive of this user checkpoint. */
export function codexBoundaryTurnId(messages: ChatMessage[], checkpointId: string): string | null {
  const userIndex = messages.findIndex((message) => message.id === checkpointId || message.checkpointId === checkpointId)
  if (userIndex < 0) return null
  const turnId = messages.slice(userIndex + 1).find((message) => message.role === 'assistant')?.metadata?.codex?.turnId
  return typeof turnId === 'string' && turnId ? turnId : null
}

export async function revertCodexThread(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  threadId: string,
  beforeTurnId: string,
): Promise<{ threadId: string }> {
  try {
    await request('thread/revert', { threadId, beforeTurnId })
    return { threadId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/only supports paginated threads/i.test(message)) throw error
    const result = await request('thread/fork', { threadId, beforeTurnId })
    const thread = result && typeof result === 'object' ? (result as { thread?: { id?: unknown } }).thread : undefined
    const forked = thread && typeof thread.id === 'string' ? thread.id : ''
    if (!forked) throw new Error('Codex returned no forked thread id')
    return { threadId: forked }
  }
}

function grokMode(method: string, mode: unknown): GrokRewindRequest | null {
  if (method === 'session.previewRewind') return 'preview'
  if (mode === 'files') return 'files_only'
  if (mode === 'conversation') return 'conversation_only'
  if (mode === 'code+chat') return 'all'
  return null
}

function refused(error: string, supportsCodeOnly = false): RewindFilesResult {
  return { canRewind: false, supportsCodeOnly, error }
}

export async function dispatchNodeRewind(args: {
  session: NodeSessionRecord
  method: string
  input: Record<string, unknown>
  host: HarnessOperationHost
  claude?: TurnRunner['callOperation']
  codex?: TurnRunner['callOperation']
  opencode?: TurnRunner['callOperation']
  rewindGrok?: (input: {
    session: NodeSessionRecord
    promptIndex: number
    mode: GrokRewindRequest
  }) => Promise<RewindFilesResult>
}): Promise<unknown> {
  const { session, method, input, host } = args
  if (session.harnessId === 'opencode') {
    if (!args.opencode) throw Object.assign(new Error(`Unsupported session operation: ${method}`), { code: 'unsupported' })
    return args.opencode(session, method, input, host)
  }
  if (method === 'session.truncateAtCheckpoint') {
    const checkpointId = String(input.checkpointId ?? '')
    const messages = truncateBeforeCheckpoint(host.messages ?? [], checkpointId)
    if (!messages) return false
    host.onEvent({ type: 'transcript_replaced', messages })
    return true
  }
  if (session.harnessId === 'claude' && args.claude) return args.claude(session, method, input, host)
  if (session.harnessId === 'codex' && args.codex) return args.codex(session, method, input, host)
  if (session.harnessId === 'acp') {
    if (isAntigravityAcpAgent(session.acpAgentId)) return refused('Antigravity does not support rewind')
    const mode = grokMode(method, input.mode)
    if (!mode) return refused('Invalid rewind mode', true)
    const promptIndex = grokPromptIndexForCheckpoint(host.messages ?? [], String(input.checkpointId ?? ''))
    if (promptIndex == null) return refused('Grok prompt boundary not found', true)
    if (!args.rewindGrok) return refused('ACP agent command not configured', true)
    return args.rewindGrok({ session, promptIndex, mode })
  }
  if (session.harnessId === 'cursor') {
    if (method === 'session.rewind' && input.mode === 'conversation') return { canRewind: true }
    return refused(CURSOR_REWIND_ERROR)
  }
  if (session.harnessId === 'dsh') {
    if (method === 'session.rewind' && input.mode === 'conversation') return { canRewind: true }
    return refused('DeepSeek harness does not support rewind yet')
  }
  if (method === 'session.rewind' && input.mode === 'conversation') return { canRewind: true }
  return refused('Rewind is not supported by this harness')
}

export type { GrokRewindMode }
