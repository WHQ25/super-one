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
import { permissionPendingReason } from '@superone/shared/pending-interaction'

export interface IntentContext {
  /** Localizer — main-process `t()` in production. */
  t(key: string, options?: Record<string, unknown>): string
  /**
   * Session title / project for the notification body. Missing session →
   * undefined. `lastAssistantText` is the body of a `completed` banner — the
   * agent's closing words are the best one-line summary of what it did.
   */
  describeSession(sessionId: string): { title?: string | null; projectPath?: string; lastAssistantText?: string | null } | undefined
  now(): number
  /** True only for the `status_change: idle` that closes a clean run — see `RunTracker`. */
  runCompleted?: boolean
}

/** Stable per-session id so one completion banner replaces the previous one. */
export function completedIntentId(sessionId: string): string {
  return `completed:${sessionId}`
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
  /** sessionId → still clean (no interrupt / error seen since the stream opened). */
  private readonly runs = new Map<string, boolean>()

  /** Feed every event; returns true for the idle that ends a clean run. */
  observe(event: AgentEvent): boolean {
    const sessionId = event.sessionId
    if (!sessionId) return false
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

/** Longest body we hand a channel; OS notifications truncate anyway, but not always gracefully. */
const MAX_BODY = 180

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY - 1)}…` : flat
}

/**
 * Session label for the notification title. Falls back to the project's
 * basename, then to a generic string — a brand-new session often has no title
 * yet, and that is exactly when a permission gate tends to fire.
 */
function sessionLabel(ctx: IntentContext, sessionId: string): { label: string; projectPath?: string } {
  const info = ctx.describeSession(sessionId)
  const title = info?.title?.trim()
  if (title) return { label: title, projectPath: info?.projectPath }
  const projectPath = info?.projectPath
  const base = projectPath?.split(/[\\/]/).filter(Boolean).pop()
  return { label: base || ctx.t('notifications.untitledSession'), projectPath }
}

function build(
  ctx: IntentContext,
  kind: NotificationKind,
  id: string,
  sessionId: string,
  body: string,
): NotificationIntent {
  const { label, projectPath } = sessionLabel(ctx, sessionId)
  return {
    id,
    kind,
    sessionId,
    projectPath,
    title: ctx.t(`notifications.kind.${kind}.title`, { session: label }),
    body: clamp(body),
    createdAt: ctx.now(),
  }
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
      // Same sentence the sidebar row shows, so the banner and the chip agree.
      const body = permissionPendingReason(req, ctx.t)
      return build(ctx, req.requestKind ? 'confirm' : 'permission', req.requestId, sessionId, body)
    }
    case 'ask_user_question': {
      const req = event.request
      const body = req.questions[0]?.question?.trim() || ctx.t('sidebar.pending.waitingInput')
      return build(ctx, 'question', req.requestId, sessionId, body)
    }
    case 'plan_approval':
      return build(ctx, 'plan', event.request.requestId, sessionId, ctx.t('sidebar.pending.reviewPlan'))
    case 'status_change': {
      if (!ctx.runCompleted) return null
      const body = ctx.describeSession(sessionId)?.lastAssistantText?.trim()
        || ctx.t('notifications.kind.completed.body')
      return build(ctx, 'completed', completedIntentId(sessionId), sessionId, body)
    }
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
  if (event.type === 'interaction_resolved') return event.requestId
  if (event.type === 'status_change' && event.status === 'streaming' && event.sessionId) {
    return completedIntentId(event.sessionId)
  }
  return null
}
