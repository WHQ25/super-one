/**
 * Node Session turn stream + durable event contracts (Phase 3 Stage 5-A).
 *
 * Turn runners emit structured {@link SessionTurnEvent} via `onEvent` so the
 * node can project text / tool / permission / status into the durable
 * environment event log. Codex Stage 4 continues to use `onDelta` only;
 * `onEvent` is additive and optional for runners that do not need structure.
 *
 * Presentation-frequency deltas may be batched by the runtime; semantic
 * transitions (tool start/result, permission, status, turn lifecycle) are
 * always durable.
 */

import type { AgentEvent } from '../agent-types'

// ---------------------------------------------------------------------------
// Stream events (TurnRunner → SessionRuntime)
// ---------------------------------------------------------------------------

/** Incremental assistant text for a content block. */
export interface SessionTurnTextEvent {
  kind: 'text'
  /** Stable id for the assistant content block within the turn. */
  blockId: string
  /** Presentation delta; omit when only publishing a final snapshot. */
  delta?: string
  /** When true, `text` is the complete block content. */
  final?: boolean
  /** Full block text when `final` is true. */
  text?: string
}

export type SessionTurnToolPhase = 'started' | 'input_delta' | 'completed' | 'failed'

/** Tool use lifecycle within a turn (Claude-style tool_use / tool_result). */
export interface SessionTurnToolEvent {
  kind: 'tool'
  phase: SessionTurnToolPhase
  toolUseId: string
  toolName: string
  /** JSON or partial JSON tool input (streaming or complete). */
  input?: string
  /** Result summary / output text. */
  output?: string
  isError?: boolean
  parentToolUseId?: string | null
}

/**
 * Permission request projected for durability / UI.
 * Decision flow remains via SessionRuntime.onPermission + respondPermission RPC;
 * runners may emit this for structured metadata alongside the blocking callback.
 */
export interface SessionTurnPermissionEvent {
  kind: 'permission'
  phase: 'requested'
  interactionId: string
  toolName?: string
  toolUseId?: string
  input?: Record<string, unknown>
}

/** Mid-turn agent status (does not replace SessionRuntime lifecycle status). */
export type SessionTurnAgentStatus =
  | 'streaming'
  | 'idle'
  | 'interrupted'
  | 'error'
  | 'background'

export interface SessionTurnStatusEvent {
  kind: 'status'
  status: SessionTurnAgentStatus
  /** Optional human-readable detail (never secrets). */
  message?: string
}

/**
 * Structured turn stream event. Discriminated on `kind`.
 * Used by Claude and future adapters; Codex may ignore and keep `onDelta`.
 */
export type SessionTurnEvent =
  | SessionTurnTextEvent
  | SessionTurnToolEvent
  | SessionTurnPermissionEvent
  | SessionTurnStatusEvent

// ---------------------------------------------------------------------------
// Durable event type strings (environment_events.event_type)
// ---------------------------------------------------------------------------

/**
 * Canonical durable Session event types written to the environment event log.
 * Keep wire strings stable — clients resume by sequence and type.
 */
export const SESSION_DURABLE_EVENT = {
  created: 'session.created',
  closed: 'session.closed',
  removed: 'session.removed',
  renamed: 'session.renamed',
  uiFlags: 'session.ui_flags',
  tagsChanged: 'session.tags_changed',
  /** Durable per-session turn defaults changed (model/effort/permissionMode/…). */
  settingsChanged: 'session.settings_changed',
  reconciled: 'session.reconciled',
  userMessage: 'session.user_message',
  turnStarted: 'session.turn_started',
  turnCompleted: 'session.turn_completed',
  turnInterrupted: 'session.turn_interrupted',
  turnError: 'session.turn_error',
  /** High-frequency assistant text delta (from onDelta or onEvent text.delta). */
  assistantDelta: 'session.assistant_delta',
  /** Final assistant text block for the turn (transcript commit). */
  assistantMessage: 'session.assistant_message',
  /** Optional complete text snapshot for a block mid-turn (onEvent text.final). */
  assistantText: 'session.assistant_text',
  toolStarted: 'session.tool_started',
  toolInputDelta: 'session.tool_input_delta',
  toolCompleted: 'session.tool_completed',
  toolFailed: 'session.tool_failed',
  permissionRequested: 'session.permission_requested',
  permissionResponded: 'session.permission_responded',
  permissionTimeout: 'session.permission_timeout',
  permissionAborted: 'session.permission_aborted',
  questionRequested: 'session.question_requested',
  questionResponded: 'session.question_responded',
  questionTimeout: 'session.question_timeout',
  questionAborted: 'session.question_aborted',
  planRequested: 'session.plan_requested',
  planResponded: 'session.plan_responded',
  planTimeout: 'session.plan_timeout',
  planAborted: 'session.plan_aborted',
  statusChanged: 'session.status_changed',
  /** Lossless harness AgentEvent payload for desktop-equivalent remote rendering. */
  agentEvent: 'session.agent_event',
  /**
   * Observability only: host action requested. Payload carries actionId — never args
   * (args are claim-only to the controller-scoped host action channel).
   */
  hostActionRequested: 'session.host_action_requested',
} as const

/** How a streaming-tier event is retired: with its message's commit, or replaced by a newer one. */
export interface StreamingEventKey {
  /** Retired when this message commits; null retires at the end of the turn. */
  messageId: string | null
  /** A newer event with the same key carries everything this one did. */
  supersedes?: string
}

/**
 * Whether a session event belongs to the streaming tier, decided by payload
 * and phase: text and thinking deltas, partial tool input, Codex item updates
 * and tool progress are superseded by what their message commits. Null means
 * the event is durable.
 */
export function streamingEventKey(eventType: string, payload: unknown): StreamingEventKey | null {
  const record = (payload ?? {}) as Record<string, unknown>
  if (eventType === SESSION_DURABLE_EVENT.assistantDelta) {
    return { messageId: typeof record.blockId === 'string' ? record.blockId : null }
  }
  if (eventType === SESSION_DURABLE_EVENT.toolInputDelta) return { messageId: null }
  if (eventType !== SESSION_DURABLE_EVENT.agentEvent) return null
  const event = record.event as AgentEvent | undefined
  switch (event?.type) {
    case 'content_delta':
      return event.delta.type === 'text' || event.delta.type === 'thinking' ? { messageId: event.messageId } : null
    case 'tool_input_delta':
    case 'tool_progress':
      return { messageId: event.messageId }
    case 'codex_item_delta':
      return event.phase === 'updated'
        ? { messageId: event.messageId, supersedes: `${event.messageId}\u0000${event.item.id}` }
        : null
    default:
      return null
  }
}

/**
 * The streaming events a durable session event commits: one message's (its
 * completion, interruption or error), every one of the turn's (`null`, the turn
 * ended), or none (`undefined`).
 */
export function committedStreamingMessage(eventType: string, payload: unknown): string | null | undefined {
  const record = (payload ?? {}) as Record<string, unknown>
  switch (eventType) {
    case SESSION_DURABLE_EVENT.assistantMessage:
      return typeof record.blockId === 'string' ? record.blockId : null
    case SESSION_DURABLE_EVENT.turnCompleted:
    case SESSION_DURABLE_EVENT.turnInterrupted:
    case SESSION_DURABLE_EVENT.turnError:
    case SESSION_DURABLE_EVENT.closed:
    case SESSION_DURABLE_EVENT.removed:
      return null
    case SESSION_DURABLE_EVENT.agentEvent: {
      const event = record.event as AgentEvent | undefined
      if (event?.type === 'message_complete' || event?.type === 'message_interrupted' || event?.type === 'message_error') return event.messageId
      if (event?.type === 'status_change' && event.status !== 'streaming') return null
      return undefined
    }
    default:
      return undefined
  }
}

export type SessionDurableEventType =
  (typeof SESSION_DURABLE_EVENT)[keyof typeof SESSION_DURABLE_EVENT]

// ---------------------------------------------------------------------------
// Durable payloads
// ---------------------------------------------------------------------------

export interface SessionAssistantDeltaPayload {
  blockId: string
  delta: string
}

export interface SessionAssistantTextPayload {
  blockId: string
  text: string
}

export interface SessionAssistantMessagePayload {
  blockId: string
  text: string
}

export interface SessionToolStartedPayload {
  toolUseId: string
  toolName: string
  input?: string
  parentToolUseId?: string | null
}

export interface SessionToolInputDeltaPayload {
  toolUseId: string
  toolName: string
  inputDelta: string
  parentToolUseId?: string | null
}

export interface SessionToolCompletedPayload {
  toolUseId: string
  toolName: string
  output?: string
  isError?: boolean
  parentToolUseId?: string | null
}

export interface SessionToolFailedPayload {
  toolUseId: string
  toolName: string
  output?: string
  parentToolUseId?: string | null
}

export interface SessionStatusChangedPayload {
  status: SessionTurnAgentStatus
  message?: string
}

export interface SessionAgentEventPayload {
  event: AgentEvent
}

export interface SessionPermissionRequestedPayload {
  interactionId: string
  kind: 'permission' | 'question' | 'plan'
  toolName?: string
  toolUseId?: string
  input?: Record<string, unknown>
  createdAt: number
}

/** Projection of a stream event into a durable log row (type + payload). */
export interface SessionDurableProjection {
  eventType: SessionDurableEventType
  payload: unknown
}

/**
 * Map a structured turn stream event to zero or more durable projections.
 * Returns empty when the event carries no durable semantic content
 * (e.g. empty text delta).
 */
export function projectSessionTurnEvent(event: SessionTurnEvent): SessionDurableProjection[] {
  switch (event.kind) {
    case 'text': {
      const out: SessionDurableProjection[] = []
      if (event.delta) {
        out.push({
          eventType: SESSION_DURABLE_EVENT.assistantDelta,
          payload: {
            blockId: event.blockId,
            delta: event.delta,
          } satisfies SessionAssistantDeltaPayload,
        })
      }
      if (event.final) {
        out.push({
          eventType: SESSION_DURABLE_EVENT.assistantText,
          payload: {
            blockId: event.blockId,
            text: event.text ?? '',
          } satisfies SessionAssistantTextPayload,
        })
      }
      return out
    }
    case 'tool': {
      switch (event.phase) {
        case 'started':
          return [
            {
              eventType: SESSION_DURABLE_EVENT.toolStarted,
              payload: {
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                input: event.input,
                parentToolUseId: event.parentToolUseId,
              } satisfies SessionToolStartedPayload,
            },
          ]
        case 'input_delta':
          if (!event.input) return []
          return [
            {
              eventType: SESSION_DURABLE_EVENT.toolInputDelta,
              payload: {
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                inputDelta: event.input,
                parentToolUseId: event.parentToolUseId,
              } satisfies SessionToolInputDeltaPayload,
            },
          ]
        case 'completed':
          return [
            {
              eventType: SESSION_DURABLE_EVENT.toolCompleted,
              payload: {
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                output: event.output,
                isError: event.isError,
                parentToolUseId: event.parentToolUseId,
              } satisfies SessionToolCompletedPayload,
            },
          ]
        case 'failed':
          return [
            {
              eventType: SESSION_DURABLE_EVENT.toolFailed,
              payload: {
                toolUseId: event.toolUseId,
                toolName: event.toolName,
                output: event.output,
                parentToolUseId: event.parentToolUseId,
              } satisfies SessionToolFailedPayload,
            },
          ]
        default: {
          const _exhaustive: never = event
          return _exhaustive
        }
      }
    }
    case 'permission':
      return [
        {
          eventType: SESSION_DURABLE_EVENT.permissionRequested,
          payload: {
            interactionId: event.interactionId,
            kind: 'permission',
            toolName: event.toolName,
            toolUseId: event.toolUseId,
            input: event.input,
            createdAt: Date.now(),
          } satisfies SessionPermissionRequestedPayload,
        },
      ]
    case 'status':
      return [
        {
          eventType: SESSION_DURABLE_EVENT.statusChanged,
          payload: {
            status: event.status,
            message: event.message,
          } satisfies SessionStatusChangedPayload,
        },
      ]
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export function isSessionTurnEvent(value: unknown): value is SessionTurnEvent {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'text' || kind === 'tool' || kind === 'permission' || kind === 'status'
}

export function isSessionDurableEventType(value: string): value is SessionDurableEventType {
  return (Object.values(SESSION_DURABLE_EVENT) as string[]).includes(value)
}
