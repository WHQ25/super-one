/**
 * Mid-turn-aware Codex run: starts turn/start, exposes turn id for steer,
 * then waits for turn/completed.
 */

import {
  createCodexAgentEventMapper,
  deriveCodexFinalResponse,
  type CodexAppServerHandle,
  type CodexAppServerTurnResult,
} from '@superone/codex'
import type { AgentEvent } from '@superone/shared/agent-types'

const TURN_WAIT_TIMEOUT_MS = 300_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

function normalizeCollaborationMode(
  value: Record<string, unknown> | string | null | undefined,
  model?: string,
  reasoningEffort?: string,
): Record<string, unknown> | undefined {
  if (!value) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim() && model) {
    return {
      mode: value.trim(),
      settings: {
        model,
        reasoning_effort: reasoningEffort ?? null,
      },
    }
  }
  return undefined
}

function extractAgentTextFromTurn(turn: Record<string, unknown>): string {
  let text = ''
  const items = Array.isArray(turn.items) ? turn.items : []
  for (const item of items) {
    const rec = asRecord(item)
    if (!rec) continue
    if (readString(rec.type) === 'agentMessage' || readString(rec.itemType) === 'agentMessage') {
      const t = readString(rec.text)
      if (t) text += t
    }
  }
  return text
}

export async function openTurnAndStream(opts: {
  client: CodexAppServerHandle
  prompt: string
  cwd: string
  threadId: string
  model?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  collaborationMode?: Record<string, unknown> | string | null
  messageId?: string
  onAgentEvent?: (event: AgentEvent) => void
  onDelta?: (text: string) => void
  signal: AbortSignal
  onTurnStarted?: (turnId: string | null) => void
}): Promise<CodexAppServerTurnResult> {
  if (opts.signal.aborted) throw new Error('Codex turn interrupted')

  const collaborationMode = normalizeCollaborationMode(
    opts.collaborationMode,
    opts.model,
    opts.reasoningEffort,
  )

  const turnStartResult = await opts.client.request(
    'turn/start',
    compactRecord({
      threadId: opts.threadId,
      input: [{ type: 'text', text: opts.prompt, text_elements: [] }],
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.reasoningEffort
        ? {
            effort: opts.reasoningEffort,
            reasoning_effort: opts.reasoningEffort,
            summary: 'concise',
          }
        : {}),
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [opts.cwd],
      },
      ...(collaborationMode ? { collaborationMode } : {}),
    }),
  )

  const turn = asRecord(turnStartResult.turn)
  const turnId = readString(turn?.id)
  opts.onTurnStarted?.(turnId)

  let finalText = ''
  const deadline = Date.now() + TURN_WAIT_TIMEOUT_MS
  const agentEventMapper = opts.onAgentEvent
    ? createCodexAgentEventMapper({
        messageId: opts.messageId ?? `codex_${turnId ?? Date.now()}`,
        emit: opts.onAgentEvent,
        model: opts.model,
        turnId,
      })
    : null
  agentEventMapper?.start(opts.threadId)

  while (!opts.signal.aborted && Date.now() < deadline) {
    let note: { method: string; params: Record<string, unknown> } | null
    try {
      note = await opts.client.nextNotification(
        Math.min(5_000, Math.max(0, deadline - Date.now())),
      )
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      agentEventMapper?.fail(error.message, /interrupt|abort/i.test(error.message))
      throw error
    }
    if (!note) {
      if (opts.signal.aborted) break
      continue
    }

    if (note.method === 'turn/completed' || note.method === 'turn/completed/v2') {
      const completedTurn = asRecord(note.params.turn)
      const completedId = readString(completedTurn?.id)
      if (turnId && completedId && completedId !== turnId) continue
    }

    if (agentEventMapper) {
      const applied = agentEventMapper.apply(note)
      if (applied.textDelta) finalText += applied.textDelta
    } else if (
      note.method === 'item/agentMessage/delta' ||
      note.method === 'item/agentMessageDelta'
    ) {
      const delta =
        readString(note.params.delta) ??
        readString(note.params.text) ??
        readString(asRecord(note.params.item)?.delta)
      if (delta) {
        finalText += delta
        opts.onDelta?.(delta)
      }
    }

    if (note.method === 'turn/completed' || note.method === 'turn/completed/v2') {
      const completedTurn = asRecord(note.params.turn)
      const status = readString(completedTurn?.status) ?? readString(note.params.status)
      if (status === 'failed' || status === 'error') {
        throw new Error('Codex turn failed')
      }
      if (status === 'interrupted' || status === 'cancelled') {
        throw new Error('Codex turn interrupted')
      }
      if (!finalText && completedTurn) {
        finalText = extractAgentTextFromTurn(completedTurn)
      }
      if (!finalText && agentEventMapper) {
        finalText = deriveCodexFinalResponse(agentEventMapper.items())
      }
      return { finalText, threadId: opts.threadId, turnId }
    }
  }

  if (opts.signal.aborted) {
    agentEventMapper?.fail('Codex turn interrupted', true)
    throw new Error('Codex turn interrupted')
  }
  agentEventMapper?.fail('Codex turn timed out waiting for turn/completed')
  throw new Error('Codex turn timed out waiting for turn/completed')
}
