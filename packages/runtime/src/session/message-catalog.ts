/**
 * Build a denser session message catalog from durable transcript + event log.
 * Electron-free; shared by SessionRuntime.listMessages.
 */
import {
  SESSION_DURABLE_EVENT,
  type EnvironmentEventEnvelope,
  type SessionMessageBlock,
  type SessionMessageToolSummary,
  type SessionMessagesListResult,
} from '@superone/shared/environment'
import type { NodeSessionRecord, TranscriptBlock } from './types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const SUMMARY_MAX = 2_000

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function truncate(text: string, max = SUMMARY_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function coerceSummary(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return truncate(value)
  try {
    return truncate(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function parseCursor(cursor: string | number | null | undefined, catalogLength: number): number {
  if (cursor == null || cursor === '') return catalogLength
  const n = typeof cursor === 'number' ? cursor : Number(cursor)
  if (!Number.isFinite(n) || n < 0) return catalogLength
  return Math.min(Math.floor(n), catalogLength)
}

function parseLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

type ToolAcc = {
  toolUseId: string
  toolName: string
  inputSummary?: string
  outputSummary?: string
  isError?: boolean
  parentToolUseId?: string | null
}

/**
 * Walk session-scoped durable events and collect tool summaries per assistant
 * block id (or provisional turn key when tools precede the assistant id).
 */
export function collectToolsByAssistantId(
  events: EnvironmentEventEnvelope[],
  sessionId: string,
): Map<string, SessionMessageToolSummary[]> {
  const toolsByAssistant = new Map<string, Map<string, ToolAcc>>()
  let currentAssistantId: string | null = null
  let turnKey = 0
  let provisionalKey = `turn-${turnKey}`

  const ensureBucket = (assistantId: string): Map<string, ToolAcc> => {
    let bucket = toolsByAssistant.get(assistantId)
    if (!bucket) {
      bucket = new Map()
      toolsByAssistant.set(assistantId, bucket)
    }
    return bucket
  }

  const mergeTools = (fromId: string, toId: string): void => {
    if (!fromId || !toId || fromId === toId) return
    const from = toolsByAssistant.get(fromId)
    if (!from) return
    const to = ensureBucket(toId)
    for (const [id, tool] of from) {
      const existing = to.get(id)
      if (!existing) {
        to.set(id, tool)
        continue
      }
      // Prefer filled fields from either side.
      to.set(id, {
        ...existing,
        ...tool,
        toolName: tool.toolName || existing.toolName,
        inputSummary: tool.inputSummary ?? existing.inputSummary,
        outputSummary: tool.outputSummary ?? existing.outputSummary,
        isError: tool.isError || existing.isError,
        parentToolUseId: tool.parentToolUseId ?? existing.parentToolUseId,
      })
    }
    toolsByAssistant.delete(fromId)
  }

  const rekeyProvisional = (toId: string): void => {
    mergeTools(provisionalKey, toId)
  }

  /** Bind turn tools onto the durable transcript assistant id (authoritative). */
  const bindAssistant = (blockId: string, options?: { authoritative?: boolean }): void => {
    rekeyProvisional(blockId)
    if (currentAssistantId && currentAssistantId !== blockId) {
      // onEvent text blockIds often differ from SessionRuntime's assistantId;
      // always fold prior sticky tools into the new id when authoritative
      // (assistant_message) so catalog matches transcript.
      if (options?.authoritative) {
        mergeTools(currentAssistantId, blockId)
      }
    }
    currentAssistantId = blockId
  }

  for (const ev of events) {
    if (ev.aggregateType && ev.aggregateType !== 'session') continue
    if (ev.aggregateId && ev.aggregateId !== sessionId) continue

    const payload = asRecord(ev.payload)

    switch (ev.eventType) {
      case SESSION_DURABLE_EVENT.turnStarted: {
        turnKey += 1
        provisionalKey = `turn-${turnKey}`
        currentAssistantId = null
        break
      }
      case SESSION_DURABLE_EVENT.userMessage: {
        // New user message starts a fresh turn association window.
        turnKey += 1
        provisionalKey = `turn-${turnKey}`
        currentAssistantId = null
        break
      }
      case SESSION_DURABLE_EVENT.assistantDelta:
      case SESSION_DURABLE_EVENT.assistantText: {
        const blockId = asString(payload.blockId)
        if (blockId) bindAssistant(blockId)
        break
      }
      case SESSION_DURABLE_EVENT.assistantMessage: {
        const blockId = asString(payload.blockId)
        if (blockId) bindAssistant(blockId, { authoritative: true })
        break
      }
      case SESSION_DURABLE_EVENT.agentEvent: {
        const raw = asRecord(payload.event)
        const type = asString(raw.type)
        if (type === 'message_start') {
          const id = asString(asRecord(raw.message).id)
          if (id) bindAssistant(id)
        } else if (type === 'message_complete') {
          const id = asString(raw.messageId)
          if (id) bindAssistant(id, { authoritative: true })
        } else if (type === 'content_delta') {
          const messageId = asString(raw.messageId)
          if (messageId) bindAssistant(messageId)
          const delta = asRecord(raw.delta)
          const dType = asString(delta.type)
          if (dType === 'tool_use') {
            const toolUseId = asString(delta.toolUseId)
            if (!toolUseId) break
            const key = currentAssistantId ?? provisionalKey
            const bucket = ensureBucket(key)
            const existing = bucket.get(toolUseId) ?? {
              toolUseId,
              toolName: asString(delta.toolName) ?? 'tool',
            }
            existing.toolName = asString(delta.toolName) ?? existing.toolName
            const input = coerceSummary(delta.input)
            if (input) existing.inputSummary = input
            if (delta.parentToolUseId !== undefined) {
              existing.parentToolUseId = asString(delta.parentToolUseId) ?? null
            }
            bucket.set(toolUseId, existing)
          } else if (dType === 'tool_result') {
            const toolUseId = asString(delta.toolUseId)
            if (!toolUseId) break
            const key = currentAssistantId ?? provisionalKey
            const bucket = ensureBucket(key)
            const existing = bucket.get(toolUseId) ?? {
              toolUseId,
              toolName: 'tool',
            }
            const out = coerceSummary(delta.summary ?? delta.output)
            if (out) existing.outputSummary = out
            if (delta.isError === true) existing.isError = true
            bucket.set(toolUseId, existing)
          }
        }
        break
      }
      case SESSION_DURABLE_EVENT.toolStarted:
      case SESSION_DURABLE_EVENT.toolInputDelta: {
        const toolUseId = asString(payload.toolUseId)
        if (!toolUseId) break
        const key = currentAssistantId ?? provisionalKey
        const bucket = ensureBucket(key)
        const existing = bucket.get(toolUseId) ?? {
          toolUseId,
          toolName: asString(payload.toolName) ?? 'tool',
        }
        existing.toolName = asString(payload.toolName) ?? existing.toolName
        const input =
          coerceSummary(payload.input) ??
          coerceSummary(payload.inputDelta) ??
          existing.inputSummary
        if (input) existing.inputSummary = input
        if (payload.parentToolUseId !== undefined) {
          existing.parentToolUseId = asString(payload.parentToolUseId) ?? null
        }
        bucket.set(toolUseId, existing)
        break
      }
      case SESSION_DURABLE_EVENT.toolCompleted:
      case SESSION_DURABLE_EVENT.toolFailed: {
        const toolUseId = asString(payload.toolUseId)
        if (!toolUseId) break
        const key = currentAssistantId ?? provisionalKey
        const bucket = ensureBucket(key)
        const existing = bucket.get(toolUseId) ?? {
          toolUseId,
          toolName: asString(payload.toolName) ?? 'tool',
        }
        existing.toolName = asString(payload.toolName) ?? existing.toolName
        const input = coerceSummary(payload.input)
        if (input) existing.inputSummary = input
        const output = coerceSummary(payload.output)
        if (output) existing.outputSummary = output
        if (ev.eventType === SESSION_DURABLE_EVENT.toolFailed || payload.isError === true) {
          existing.isError = true
        }
        if (payload.parentToolUseId !== undefined) {
          existing.parentToolUseId = asString(payload.parentToolUseId) ?? null
        }
        bucket.set(toolUseId, existing)
        break
      }
      case SESSION_DURABLE_EVENT.turnCompleted:
      case SESSION_DURABLE_EVENT.turnInterrupted:
      case SESSION_DURABLE_EVENT.turnError: {
        currentAssistantId = null
        break
      }
      default:
        break
    }
  }

  const out = new Map<string, SessionMessageToolSummary[]>()
  for (const [assistantId, bucket] of toolsByAssistant) {
    if (assistantId.startsWith('turn-')) continue
    const list: SessionMessageToolSummary[] = []
    for (const tool of bucket.values()) {
      list.push({
        toolUseId: tool.toolUseId,
        toolName: tool.toolName,
        ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
        ...(tool.outputSummary ? { outputSummary: tool.outputSummary } : {}),
        ...(tool.isError ? { isError: true } : {}),
        ...(tool.parentToolUseId !== undefined
          ? { parentToolUseId: tool.parentToolUseId }
          : {}),
      })
    }
    if (list.length > 0) out.set(assistantId, list)
  }
  return out
}

function extractCheckpointMeta(
  events: EnvironmentEventEnvelope[],
  sessionId: string,
  blockId: string,
): { checkpointId?: string; resumePointId?: string; metadata?: Record<string, unknown> } {
  // Scan agent_event / assistant_message payloads for optional ids matching this block.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!
    if (ev.aggregateType && ev.aggregateType !== 'session') continue
    if (ev.aggregateId && ev.aggregateId !== sessionId) continue
    const payload = asRecord(ev.payload)
    if (ev.eventType === SESSION_DURABLE_EVENT.assistantMessage) {
      if (asString(payload.blockId) !== blockId) continue
      const checkpointId = asString(payload.checkpointId)
      const resumePointId = asString(payload.resumePointId)
      const metadata =
        payload.metadata && typeof payload.metadata === 'object'
          ? (payload.metadata as Record<string, unknown>)
          : undefined
      if (checkpointId || resumePointId || metadata) {
        return {
          ...(checkpointId ? { checkpointId } : {}),
          ...(resumePointId ? { resumePointId } : {}),
          ...(metadata ? { metadata } : {}),
        }
      }
    }
    if (ev.eventType === SESSION_DURABLE_EVENT.agentEvent) {
      const raw = asRecord(payload.event)
      if (asString(raw.type) !== 'message_complete' && asString(raw.type) !== 'checkpoint_captured') {
        continue
      }
      const messageId = asString(raw.messageId) ?? asString(raw.id)
      if (messageId && messageId !== blockId) continue
      const checkpointId = asString(raw.checkpointId)
      const resumePointId = asString(raw.resumePointId)
      if (checkpointId || resumePointId) {
        return {
          ...(checkpointId ? { checkpointId } : {}),
          ...(resumePointId ? { resumePointId } : {}),
        }
      }
    }
  }
  return {}
}

/** Expand transcript (+ event tools) into a full chronological catalog. */
export function buildSessionMessageCatalog(
  session: Pick<NodeSessionRecord, 'sessionId' | 'transcript' | 'providerResume'>,
  events: EnvironmentEventEnvelope[],
): SessionMessageBlock[] {
  const toolsByAssistant = collectToolsByAssistantId(events, session.sessionId)
  const transcript = Array.isArray(session.transcript) ? session.transcript : []
  const out: SessionMessageBlock[] = []

  for (let i = 0; i < transcript.length; i++) {
    const block = transcript[i] as TranscriptBlock
    const role =
      block.role === 'user' || block.role === 'assistant' || block.role === 'system'
        ? block.role
        : 'system'
    const tools = role === 'assistant' ? toolsByAssistant.get(block.id) : undefined
    const extra =
      role === 'assistant'
        ? extractCheckpointMeta(events, session.sessionId, block.id)
        : {}
    // Last assistant may carry provider resume as resumePointId when not already set.
    let resumePointId = extra.resumePointId
    if (
      !resumePointId &&
      role === 'assistant' &&
      i === transcript.length - 1 &&
      session.providerResume
    ) {
      resumePointId = session.providerResume
    }
    out.push({
      id: block.id,
      role,
      text: typeof block.text === 'string' ? block.text : '',
      createdAt: typeof block.createdAt === 'number' ? block.createdAt : Date.now(),
      sortOrder: i,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(extra.metadata ? { metadata: extra.metadata } : {}),
      ...(extra.checkpointId ? { checkpointId: extra.checkpointId } : {}),
      ...(resumePointId ? { resumePointId } : {}),
    })
  }

  return out
}

/** Page a full catalog with desktop-style end-cursor pagination. */
export function pageSessionMessageCatalog(
  sessionId: string,
  catalog: SessionMessageBlock[],
  opts?: { cursor?: string | number | null; limit?: number },
): SessionMessagesListResult {
  const limit = parseLimit(opts?.limit)
  const endIndex = parseCursor(opts?.cursor, catalog.length)
  const startIndex = Math.max(0, endIndex - limit)
  const slice = catalog.slice(startIndex, endIndex)
  const hasMore = startIndex > 0
  return {
    sessionId,
    messages: slice,
    cursor: hasMore ? String(startIndex) : null,
    hasMore,
  }
}
