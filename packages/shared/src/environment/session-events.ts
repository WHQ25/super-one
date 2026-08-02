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
  statusChanged: 'session.status_changed',
  /**
   * Observability only: host action requested. Payload carries actionId — never args
   * (args are claim-only to the controller-scoped host action channel).
   */
  hostActionRequested: 'session.host_action_requested',
} as const

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
