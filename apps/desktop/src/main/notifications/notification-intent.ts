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
 */

import type { AgentEvent } from '@superone/shared/agent-types'
import type { NotificationIntent, NotificationKind } from '@superone/shared/notifications'
import { permissionPendingReason } from '@superone/shared/pending-interaction'

export interface IntentContext {
  /** Localizer — main-process `t()` in production. */
  t(key: string, options?: Record<string, unknown>): string
  /** Session title / project for the notification body. Missing session → undefined. */
  describeSession(sessionId: string): { title?: string | null; projectPath?: string } | undefined
  now(): number
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
    default:
      return null
  }
}

/**
 * Notification id this event retracts, or null.
 *
 * `interaction_resolved` is the only signal used, and it is enough: it fires
 * whether the user answered in this window, in another window, or on a phone,
 * and every host confirm settles through `HostConfirmRegistry`, which emits one
 * on *every* terminal path (answer, cancel, timeout). (Note
 * `elicitation_complete` carries the *SDK's* elicitation id, which is unrelated
 * to the locally minted `elicit_*` requestId — it would never match.)
 */
export function withdrawIdForEvent(event: AgentEvent): string | null {
  return event.type === 'interaction_resolved' ? event.requestId : null
}
