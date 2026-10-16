/**
 * Trigger layer: AgentEvent → NotificationIntent.
 *
 * Pure (no Electron, no i18n singleton, no clock) so the "which events deserve
 * a notification" decision is testable on its own. Localization and session
 * lookup are injected — the caller owns those.
 *
 * The set of events handled here is deliberately the same set the sidebar
 * treats as "this session is waiting on you" (`getPendingReason`): a pending
 * permission (of any `requestKind`), a question, or a plan approval. Keeping
 * the two surfaces on one definition is the point — a notification for
 * something the sidebar does not flag, or vice versa, reads as a bug.
 *
 * Plus one non-interaction: a run finishing. The sidebar marks that as an
 * unseen completion on `status_change: idle`; `RunTracker` narrows it to runs
 * that actually streamed and were not interrupted or errored, so a replayed
 * idle on reconnect or a user-initiated stop never rings.
 */

import type { AgentEvent } from '@superone/shared/agent-types'
import type { NotificationIntent, NotificationKind } from '@superone/shared/notifications'
import { displayHostPath, parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

export interface NotificationSessionDescription {
  title?: string | null
  projectPath?: string
  environmentLabel?: string
}

export interface IntentContext {
  /** Localizer — main-process `t()` in production. */
  t(key: string, options?: Record<string, unknown>): string
  /** Session title / project for the notification title. Missing session → undefined. */
  describeSession(sessionId: string, projectPath?: string): NotificationSessionDescription | undefined
  now(): number
  /** True only for the `status_change: idle` that closes a clean run — see `RunTracker`. */
  runCompleted?: boolean
}

/** Stable per-session id so one completion banner replaces the previous one. */
export function completedIntentId(sessionId: string): string {
  return `completed:${sessionId}`
}

/** Session and interaction ids belong to their execution host. */
function scopedId(id: string, projectPath?: string): string {
  const remote = projectPath && parseRemoteProjectKey(projectPath)
  return remote ? `remote:${remote.connectionId}:${id}` : id
}

/**
 * Tracks which sessions are mid-run so `status_change: idle` can be told apart
 * from the idles that mean nothing: session init, reconnect replay, the tail
 * of an interrupt, the tail of an error.
 *
 * `background` counts as running — a run that was parked and then finished is
 * still a finished run. `message_complete` is deliberately ignored: Codex
 * fires one at every queued-turn boundary while the stream continues, and
 * only `idle` closes the run (same reasoning as `Session._backendStreaming`).
 */
export class RunTracker {
  /** Host-scoped session id → no interrupt / error since the stream opened. */
  private readonly runs = new Map<string, boolean>()

  /** Feed every event; returns true for the idle that ends a clean run. */
  observe(event: AgentEvent): boolean {
    if (!event.sessionId) return false
    const sessionId = scopedId(event.sessionId, event.projectPath)
    switch (event.type) {
      case 'status_change': {
        if (event.status === 'streaming' || event.status === 'background') {
          if (!this.runs.has(sessionId)) this.runs.set(sessionId, true)
          return false
        }
        const clean = this.runs.get(sessionId)
        this.runs.delete(sessionId)
        return event.status === 'idle' && clean === true
      }
      case 'message_interrupted':
      case 'message_error':
        if (this.runs.has(sessionId)) this.runs.set(sessionId, false)
        return false
      default:
        return false
    }
  }
}

/**
 * Notification title. Falls back to the project's basename, then to a generic
 * string — a brand-new session often has no title yet, and that is exactly
 * when a permission gate tends to fire.
 */
export function withSessionDescription(
  intent: NotificationIntent,
  info: NotificationSessionDescription | undefined,
  t: IntentContext['t'],
): NotificationIntent {
  // Preserve the event's explicit host route even if metadata is unavailable.
  const projectPath = intent.projectPath ?? info?.projectPath
  const title = info?.title?.trim()
  const base = projectPath && displayHostPath(projectPath).split(/[\\/]/).filter(Boolean).pop()
  const label = title || base || t('notifications.untitledSession')
  const environmentLabel = info?.environmentLabel?.trim()
  return { ...intent, projectPath, title: environmentLabel ? `${environmentLabel} · ${label}` : label }
}

/** Body per kind — a fixed status, never content from the request itself. */
const BODY_KEY: Record<NotificationKind, string> = {
  permission: 'notifications.waitingApproval',
  confirm: 'notifications.waitingApproval',
  plan: 'notifications.waitingApproval',
  question: 'notifications.waitingInput',
  completed: 'notifications.completed',
  stalled: 'notifications.stalled',
}

/**
 * Two lines, nothing else: the session as title, a fixed status as body. An
 * OS banner is a glance surface; what the agent is asking (the tool, the
 * question, the plan) belongs in the app the click lands on, and only bloats
 * the banner.
 */
function build(ctx: IntentContext, kind: NotificationKind, id: string, sessionId: string, projectPath?: string): NotificationIntent {
  const body = ctx.t(BODY_KEY[kind])
  return withSessionDescription({
    id: scopedId(id, projectPath), kind, sessionId, projectPath, title: '', body, createdAt: ctx.now(),
  }, ctx.describeSession(sessionId, projectPath), ctx.t)
}

/** One banner per session: a later stall replaces it, renewed activity withdraws it. */
export function stalledIntentId(sessionId: string): string {
  return `stalled:${sessionId}`
}

/** A collaboration child stuck mid-run. Raised by the collaboration monitor, not by an event. */
export function stalledIntent(sessionId: string, ctx: IntentContext): NotificationIntent {
  return build(ctx, 'stalled', stalledIntentId(sessionId), sessionId)
}

/**
 * The intent this event should raise, or null when the event is not a
 * human-intervention signal.
 *
 * `permission_request` splits two ways on purpose. A bare request is an
 * ordinary tool permission gate. One carrying `requestKind` is a *host*
 * confirmation raised from inside a tool executor — `session_collab_request`,
 * `config_apply`, `media_generate_video`, computer-use grants, session cleanup,
 * automation, WebMCP trust, MCP elicitation. Those are far more consequential
 * than "may I run Read", so they get their own opt-out.
 *
 * Note two host confirms deliberately set no `requestKind` (`miniapp_call`,
 * `device_request_control`) and therefore land in the permission bucket — that
 * matches how the sidebar labels them too.
 */
export function intentForEvent(event: AgentEvent, ctx: IntentContext): NotificationIntent | null {
  const sessionId = event.sessionId
  if (!sessionId) return null

  switch (event.type) {
    case 'permission_request': {
      const req = event.request
      return build(ctx, req.requestKind ? 'confirm' : 'permission', req.requestId, sessionId, event.projectPath)
    }
    case 'ask_user_question':
      return build(ctx, 'question', event.request.requestId, sessionId, event.projectPath)
    case 'plan_approval':
      return build(ctx, 'plan', event.request.requestId, sessionId, event.projectPath)
    case 'status_change':
      if (!ctx.runCompleted) return null
      return build(ctx, 'completed', completedIntentId(sessionId), sessionId, event.projectPath)
    default:
      return null
  }
}

/**
 * Notification id this event retracts, or null.
 *
 * For interactions, `interaction_resolved` is the only signal used, and it is
 * enough: it fires whether the user answered in this window, in another
 * window, or on a phone, and every host confirm settles through
 * `HostConfirmRegistry`, which emits one on *every* terminal path (answer,
 * cancel, timeout). (Note `elicitation_complete` carries the *SDK's*
 * elicitation id, which is unrelated to the locally minted `elicit_*`
 * requestId — it would never match.)
 *
 * A completion banner is retracted by the next run starting: the "done" it
 * announced is no longer true, and releasing the id is what lets the next
 * completion ring after one that was suppressed.
 */
export function withdrawIdForEvent(event: AgentEvent): string | null {
  if (event.type === 'interaction_resolved') return scopedId(event.requestId, event.projectPath)
  if (event.type === 'status_change' && event.status === 'streaming' && event.sessionId) {
    return scopedId(completedIntentId(event.sessionId), event.projectPath)
  }
  return null
}
