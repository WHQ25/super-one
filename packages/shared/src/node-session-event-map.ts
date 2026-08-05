/**
 * Map node durable `session.*` environment events → desktop `AgentEvent`s
 * for remote chat UI streaming.
 *
 * Lossless `session.agent_event` payloads pass through with local routing
 * metadata. Legacy text/tool/status durable events remain supported for other
 * harnesses and older nodes.
 *
 * Missing optional fields are skipped, unknown event types yield nothing,
 * and non-text payloads never throw.
 */
import type {
  AgentEvent,
  AgentStatus,
  AskUserQuestionRequest,
  ChatMessage,
  PermissionRequest,
  PlanApprovalRequest,
  UserQuestion,
} from './agent-types'
import type { EnvironmentEventEnvelope } from './environment/events'
import { SESSION_DURABLE_EVENT } from './environment/session-events'

export type NodeSessionEventMapContext = {
  /** Desktop project key (`remote:<connectionId>:<hostPath>`) for chat routing. */
  projectPath?: string
  sessionId: string
  providerId?: string
  /** ISO timestamp factory (injectable for tests). */
  nowIso?: () => string
  /**
   * When true, skip `session.user_message` → `user_message_appended`.
   * Use when the desktop already echoed the user bubble optimistically
   * (node blockIds differ from the clientMessageId).
   */
  skipUserMessage?: boolean
}

export type NodeSessionEventMapper = {
  map(envelope: EnvironmentEventEnvelope): AgentEvent[]
  /** Last assistant message id started for this session (if any). */
  currentAssistantMessageId(): string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Coerce tool input to the string form desktop tool_use blocks expect. */
function coerceToolInput(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function stamp(
  event: AgentEvent,
  ctx: NodeSessionEventMapContext,
  sequence?: string,
): AgentEvent {
  const seqNum = sequence && /^\d+$/.test(sequence) ? Number(sequence) : undefined
  return {
    ...event,
    ...(ctx.projectPath ? { projectPath: ctx.projectPath } : {}),
    sessionId: ctx.sessionId,
    ...(seqNum !== undefined && Number.isFinite(seqNum) ? { seq: seqNum } : {}),
  }
}

function mapQuestionRequest(
  payload: Record<string, unknown>,
  fallbackId: string,
): AskUserQuestionRequest | null {
  const interactionId =
    asString(payload.interactionId) ?? asString(payload.requestId) ?? fallbackId
  const input = asRecord(payload.input)
  const rawQuestions = Array.isArray(payload.questions)
    ? payload.questions
    : Array.isArray(input.questions)
      ? input.questions
      : []
  const questions: UserQuestion[] = []
  for (const q of rawQuestions) {
    if (!q || typeof q !== 'object') continue
    const row = q as Record<string, unknown>
    const question = asString(row.question) ?? asString(row.header) ?? ''
    if (!question) continue
    const optionsRaw = Array.isArray(row.options) ? row.options : []
    const options = optionsRaw
      .map((opt) => {
        if (!opt || typeof opt !== 'object') return null
        const o = opt as Record<string, unknown>
        const label = asString(o.label) ?? asString(o.value) ?? ''
        if (!label) return null
        return {
          label,
          description: asString(o.description) ?? '',
          ...(asString(o.preview) ? { preview: asString(o.preview) } : {}),
        }
      })
      .filter((o): o is NonNullable<typeof o> => o != null)
    questions.push({
      question,
      header: asString(row.header) ?? question,
      options,
      multiSelect: row.multiSelect === true || row.multiple === true,
    })
  }
  if (questions.length === 0) {
    // Still surface a minimal prompt so the UI can answer and unblock the turn.
    questions.push({
      question: asString(payload.toolName) ? `Respond to ${asString(payload.toolName)}` : 'Continue?',
      header: 'Question',
      options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }],
      multiSelect: false,
    })
  }
  return { requestId: interactionId, questions }
}

function mapPlanRequest(
  payload: Record<string, unknown>,
  fallbackId: string,
): PlanApprovalRequest | null {
  const interactionId =
    asString(payload.interactionId) ?? asString(payload.requestId) ?? fallbackId
  const input = asRecord(payload.input)
  let planContent =
    asString(payload.plan) ??
    asString(payload.planContent) ??
    asString(input.plan) ??
    asString(input.planContent) ??
    ''
  if (!planContent && input.plan && typeof input.plan === 'object') {
    try {
      planContent = JSON.stringify(input.plan)
    } catch {
      planContent = ''
    }
  }
  return {
    requestId: interactionId,
    planContent: planContent || 'Plan approval required',
    planFilePath: asString(payload.planFilePath) ?? asString(input.planFilePath) ?? '',
    allowedPrompts: Array.isArray(payload.allowedPrompts)
      ? (payload.allowedPrompts as PlanApprovalRequest['allowedPrompts'])
      : Array.isArray(input.allowedPrompts)
        ? (input.allowedPrompts as PlanApprovalRequest['allowedPrompts'])
        : [],
  }
}

function userMessage(ctx: NodeSessionEventMapContext, blockId: string, text: string, nowIso: string): ChatMessage {
  return {
    id: blockId,
    role: 'user',
    status: 'complete',
    content: text ? [{ type: 'text', text }] : [],
    createdAt: nowIso,
    providerId: ctx.providerId ?? 'codex',
  }
}

function assistantMessage(ctx: NodeSessionEventMapContext, blockId: string, nowIso: string): ChatMessage {
  return {
    id: blockId,
    role: 'assistant',
    status: 'streaming',
    content: [],
    createdAt: nowIso,
    providerId: ctx.providerId ?? 'codex',
  }
}

function mapAgentStatus(status: string | undefined, fallback: AgentStatus): AgentStatus {
  if (status === 'streaming' || status === 'idle' || status === 'error' || status === 'background') {
    return status
  }
  // Node mid-turn / durable statuses that don't exist on AgentStatus.
  if (status === 'interrupted' || status === 'ended' || status === 'unknown') return 'idle'
  return fallback
}

/**
 * Stateful mapper: tracks which assistant blockIds already emitted `message_start`
 * so consecutive `session.assistant_delta` events only produce content deltas.
 */
export function createNodeSessionEventMapper(ctx: NodeSessionEventMapContext): NodeSessionEventMapper {
  const startedAssistantIds = new Set<string>()
  const completedAssistantIds = new Set<string>()
  let lastAssistantId: string | null = null
  let rawTerminalThisTurn = false
  const nowIso = ctx.nowIso ?? (() => new Date().toISOString())

  /**
   * One sticky assistant message per turn for chat UI parity.
   * Claude may emit tools before any text block, and text blockIds from the
   * print stream differ from SessionRuntime's transcript assistant id — route
   * all turn content onto the first opened message.
   */
  const ensureAssistant = (
    push: (event: AgentEvent) => void,
    preferredId?: string,
  ): string => {
    if (lastAssistantId) return lastAssistantId
    const id = preferredId && preferredId.length > 0
      ? preferredId
      : `assistant-${ctx.sessionId}`
    if (!startedAssistantIds.has(id)) {
      startedAssistantIds.add(id)
      push({
        type: 'message_start',
        message: assistantMessage(ctx, id, nowIso()),
      })
    }
    lastAssistantId = id
    return id
  }

  const mapOne = (envelope: EnvironmentEventEnvelope): AgentEvent[] => {
    // Only session aggregate events for this session (tolerate broader logs).
    if (envelope.aggregateType && envelope.aggregateType !== 'session') return []
    if (envelope.aggregateId && envelope.aggregateId !== ctx.sessionId) return []

    const eventType = envelope.eventType
    const payload = asRecord(envelope.payload)
    const out: AgentEvent[] = []
    const push = (event: AgentEvent) => {
      out.push(stamp(event, ctx, envelope.sequence))
    }

    switch (eventType) {
      case SESSION_DURABLE_EVENT.userMessage: {
        if (ctx.skipUserMessage) break
        const blockId = asString(payload.blockId) ?? `user-${envelope.eventId}`
        const text = asString(payload.text) ?? ''
        push({
          type: 'user_message_appended',
          message: userMessage(ctx, blockId, text, nowIso()),
        })
        break
      }

      case SESSION_DURABLE_EVENT.turnStarted: {
        // New turn: drop sticky assistant so the next content opens a fresh message.
        lastAssistantId = null
        rawTerminalThisTurn = false
        push({
          type: 'status_change',
          status: mapAgentStatus(asString(payload.status), 'streaming'),
        })
        break
      }

      case SESSION_DURABLE_EVENT.agentEvent: {
        const rawEvent = asRecord(payload.event)
        const type = asString(rawEvent.type)
        if (!type) break

        // Routing metadata belongs to the receiving desktop connection, never
        // to the remote harness payload.
        const eventRecord = { ...rawEvent }
        delete eventRecord.projectPath
        delete eventRecord.sessionId
        delete eventRecord.draftSessionId
        delete eventRecord.seq
        delete eventRecord.epoch
        const event = eventRecord as AgentEvent
        const rawMessageId = type === 'message_start'
          ? asString(asRecord(eventRecord.message).id)
          : asString(eventRecord.messageId)

        if (type === 'message_start' && rawMessageId) {
          startedAssistantIds.add(rawMessageId)
          lastAssistantId = rawMessageId
        } else if (rawMessageId) {
          ensureAssistant(push, rawMessageId)
        }

        push(event)
        if (
          rawMessageId
          && (type === 'message_complete' || type === 'message_error' || type === 'message_interrupted')
        ) {
          completedAssistantIds.add(rawMessageId)
          rawTerminalThisTurn = true
        }
        break
      }

      case SESSION_DURABLE_EVENT.assistantDelta: {
        const wireBlockId = asString(payload.blockId)
        const messageId = ensureAssistant(push, wireBlockId ?? `assistant-${envelope.eventId}`)
        const delta = asString(payload.delta) ?? asString(payload.text) ?? ''
        // Tolerate empty deltas (heartbeats / flushes) without emitting noise.
        if (delta) {
          push({
            type: 'content_delta',
            messageId,
            delta: { type: 'text', text: delta },
          })
        }
        break
      }

      case SESSION_DURABLE_EVENT.assistantText: {
        // Optional mid-turn full snapshot (onEvent text.final). Prefer when no
        // deltas were seen yet; otherwise skip to avoid doubling streamed text.
        const wireBlockId = asString(payload.blockId)
        const text = asString(payload.text) ?? ''
        const first = lastAssistantId == null
        const messageId = ensureAssistant(push, wireBlockId ?? `assistant-${envelope.eventId}`)
        if (first && text) {
          push({
            type: 'content_delta',
            messageId,
            delta: { type: 'text', text },
          })
        }
        break
      }

      case SESSION_DURABLE_EVENT.assistantMessage: {
        const wireBlockId = asString(payload.blockId)
        if (wireBlockId && completedAssistantIds.has(wireBlockId)) break
        const text = asString(payload.text)
        const wasOpen = lastAssistantId != null
        const messageId = ensureAssistant(push, wireBlockId ?? `assistant-${envelope.eventId}`)
        // Snapshot-only path (no prior deltas): seed full text on the message.
        if (!wasOpen && text) {
          push({
            type: 'content_delta',
            messageId,
            delta: { type: 'text', text },
          })
        }
        push({ type: 'message_complete', messageId })
        break
      }

      case SESSION_DURABLE_EVENT.toolStarted: {
        const toolUseId = asString(payload.toolUseId) ?? envelope.eventId
        const toolName = asString(payload.toolName) ?? 'tool'
        const input = coerceToolInput(payload.input)
        const parentToolUseId = asString(payload.parentToolUseId) ?? null
        const messageId = ensureAssistant(push, `assistant-${envelope.eventId}`)
        push({
          type: 'content_delta',
          messageId,
          delta: {
            type: 'tool_use',
            toolUseId,
            toolName,
            input,
            status: 'streaming',
            parentToolUseId,
          },
        })
        break
      }

      case SESSION_DURABLE_EVENT.toolInputDelta: {
        const toolUseId = asString(payload.toolUseId) ?? envelope.eventId
        const partialJson =
          asString(payload.inputDelta)
          ?? asString(payload.partialJson)
          ?? (typeof payload.input === 'string' ? payload.input : '')
        if (!partialJson) break
        const messageId = ensureAssistant(push, `assistant-${envelope.eventId}`)
        push({
          type: 'tool_input_delta',
          messageId,
          toolUseId,
          partialJson,
          parentToolUseId: asString(payload.parentToolUseId) ?? null,
        })
        break
      }

      case SESSION_DURABLE_EVENT.toolCompleted:
      case SESSION_DURABLE_EVENT.toolFailed: {
        const toolUseId = asString(payload.toolUseId) ?? envelope.eventId
        const toolName = asString(payload.toolName) ?? 'tool'
        const output = asString(payload.output) ?? ''
        const isError =
          eventType === SESSION_DURABLE_EVENT.toolFailed || asBool(payload.isError) === true
        const messageId = ensureAssistant(push, `assistant-${envelope.eventId}`)
        // Mark the tool_use block complete before attaching the result summary.
        push({
          type: 'content_delta',
          messageId,
          delta: {
            type: 'tool_use',
            toolUseId,
            toolName,
            input: coerceToolInput(payload.input),
            status: 'complete',
            parentToolUseId: asString(payload.parentToolUseId) ?? null,
          },
        })
        push({
          type: 'content_delta',
          messageId,
          delta: {
            type: 'tool_result',
            toolUseId,
            summary: output || (isError ? 'failed' : 'done'),
            isError,
            parentToolUseId: asString(payload.parentToolUseId) ?? null,
          },
        })
        break
      }

      case SESSION_DURABLE_EVENT.turnCompleted: {
        if (rawTerminalThisTurn) {
          lastAssistantId = null
          rawTerminalThisTurn = false
          break
        }
        lastAssistantId = null
        push({
          type: 'status_change',
          status: mapAgentStatus(asString(payload.status), 'idle'),
        })
        break
      }

      case SESSION_DURABLE_EVENT.turnInterrupted: {
        if (rawTerminalThisTurn) {
          lastAssistantId = null
          rawTerminalThisTurn = false
          break
        }
        if (lastAssistantId) {
          push({ type: 'message_interrupted', messageId: lastAssistantId })
        }
        lastAssistantId = null
        push({ type: 'status_change', status: 'idle' })
        break
      }

      case SESSION_DURABLE_EVENT.turnError: {
        if (rawTerminalThisTurn) {
          lastAssistantId = null
          rawTerminalThisTurn = false
          break
        }
        const message = asString(payload.message) ?? 'remote turn failed'
        if (lastAssistantId) {
          push({ type: 'message_error', messageId: lastAssistantId, error: message })
        }
        lastAssistantId = null
        push({ type: 'status_change', status: 'error' })
        break
      }

      case SESSION_DURABLE_EVENT.statusChanged: {
        push({
          type: 'status_change',
          status: mapAgentStatus(asString(payload.status), 'idle'),
        })
        break
      }

      case SESSION_DURABLE_EVENT.permissionRequested: {
        const interactionId =
          asString(payload.interactionId) ?? asString(payload.requestId) ?? envelope.eventId
        const toolName = asString(payload.toolName) ?? 'tool'
        const request: PermissionRequest = {
          requestId: interactionId,
          toolName,
          toolUseId: asString(payload.toolUseId),
          input: asRecord(payload.input),
          allowAlwaysAllow: payload.allowAlwaysAllow !== false,
        }
        push({ type: 'permission_request', request })
        break
      }

      case SESSION_DURABLE_EVENT.permissionResponded:
      case SESSION_DURABLE_EVENT.permissionTimeout:
      case SESSION_DURABLE_EVENT.permissionAborted: {
        const interactionId =
          asString(payload.interactionId) ?? asString(payload.requestId) ?? envelope.eventId
        const decision = asString(payload.decision)
        const approved = decision === 'allow' || decision === 'allow_always'
        push({
          type: 'interaction_resolved',
          interactionType: 'permission',
          requestId: interactionId,
          approved,
        })
        break
      }

      case SESSION_DURABLE_EVENT.questionRequested: {
        const request = mapQuestionRequest(payload, envelope.eventId)
        if (request) push({ type: 'ask_user_question', request })
        break
      }

      case SESSION_DURABLE_EVENT.questionResponded:
      case SESSION_DURABLE_EVENT.questionTimeout:
      case SESSION_DURABLE_EVENT.questionAborted: {
        const interactionId =
          asString(payload.interactionId) ?? asString(payload.requestId) ?? envelope.eventId
        push({
          type: 'interaction_resolved',
          interactionType: 'question',
          requestId: interactionId,
          approved: eventType === SESSION_DURABLE_EVENT.questionResponded,
        })
        break
      }

      case SESSION_DURABLE_EVENT.planRequested: {
        const request = mapPlanRequest(payload, envelope.eventId)
        if (request) push({ type: 'plan_approval', request })
        break
      }

      case SESSION_DURABLE_EVENT.planResponded:
      case SESSION_DURABLE_EVENT.planTimeout:
      case SESSION_DURABLE_EVENT.planAborted: {
        const interactionId =
          asString(payload.interactionId) ?? asString(payload.requestId) ?? envelope.eventId
        const decision = asString(payload.decision)
        const approved = decision === 'approve' || decision === 'approved'
        push({
          type: 'interaction_resolved',
          interactionType: 'plan_approval',
          requestId: interactionId,
          approved,
          ...(asString(payload.feedback) ? { feedback: asString(payload.feedback) } : {}),
        })
        break
      }

      case SESSION_DURABLE_EVENT.renamed: {
        const title = asString(payload.title)
        if (title != null) {
          const sourceRaw = asString(payload.source)
          const source = sourceRaw === 'agent' || sourceRaw === 'user' ? sourceRaw : 'user'
          push({
            type: 'session_title_changed',
            sessionId: ctx.sessionId,
            title,
            source,
          })
        }
        break
      }

      case SESSION_DURABLE_EVENT.closed:
      case SESSION_DURABLE_EVENT.removed: {
        push({ type: 'status_change', status: 'idle' })
        break
      }

      case SESSION_DURABLE_EVENT.created:
      case SESSION_DURABLE_EVENT.reconciled:
      case SESSION_DURABLE_EVENT.uiFlags:
        // Lifecycle/metadata only — no chat stream side effects yet.
        break

      default:
        // Tolerate unknown / future rich events without throwing.
        break
    }

    return out
  }

  return {
    map: mapOne,
    currentAssistantMessageId: () => lastAssistantId,
  }
}

/** Map a batch of envelopes in order (shared mapper state). */
export function mapNodeSessionEvents(
  envelopes: EnvironmentEventEnvelope[],
  ctx: NodeSessionEventMapContext,
): AgentEvent[] {
  const mapper = createNodeSessionEventMapper(ctx)
  const out: AgentEvent[] = []
  for (const envelope of envelopes) {
    out.push(...mapper.map(envelope))
  }
  return out
}
