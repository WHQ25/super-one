import type { AgentEvent, ScheduledSend } from '@superone/shared/agent-types'
import type { AdvertisedHarnessId } from '@superone/shared/environment'
import { remoteProjectKey } from '@superone/shared/remote-resource-key'
import type { SessionActivity } from '@superone/shared/session-activity'
import type { RemoteListObserver } from './remote-session-feed'

export type SessionActivityEvent = Extract<AgentEvent, { type: 'session_activity' }>

export type ScheduleEvent = Extract<AgentEvent, { type: 'scheduled_send_changed' }>

/** What this desktop does with a node's list changes, in its own project keys (`remote:<connectionId>:<path>`). */
export interface RemoteListHandlers {
  /** A project's session list changed, or, without a key, any of them. */
  sessionListChanged(projectKey?: string): void
  projectsChanged(): void
  /** A session's sidebar summary (running, read). */
  schedule?(event: ScheduleEvent): void
  activity(event: SessionActivityEvent): void
  /** Provider credentials, bindings, or Claude accounts changed on the node. */
  catalogChanged?(): void
  /** The node's enabled, ready harness set changed. */
  harnessCatalogChanged?(harnessIds: readonly AdvertisedHarnessId[]): void
}

/**
 * Reads a node's list topics the way its phones do: `session_list_changed`
 * names the project to re-read, `session_activity` carries a row's live
 * state, and a snapshot (a fresh subscribe, or changes the node no longer
 * holds) re-reads everything and replaces the summaries.
 *
 * `summaries` holds the node's latest summary of each session it holds live,
 * by session id, kept by the caller across reconnects. A snapshot lists every
 * live session, so one missing from it no longer runs there: a row still
 * shown running goes idle, as a phone resets its own, and keeps its unread dot.
 */
export function remoteListObserver(connectionId: string, summaries: Map<string, SessionActivity>, handlers: RemoteListHandlers, scheduledIds = new Set<string>()): RemoteListObserver {
  const publish = (event: SessionActivityEvent) => handlers.activity({
    ...event, activity: { ...event.activity, projectPath: remoteProjectKey(connectionId, event.activity.projectPath) },
  })
  const activity = (event: SessionActivityEvent) => {
    summaries.set(event.activity.sessionId, event.activity)
    publish(event)
  }
  const schedule = (event: ScheduleEvent) => {
    if (event.scheduled) scheduledIds.add(event.sessionId)
    else scheduledIds.delete(event.sessionId)
    handlers.schedule?.(event)
  }
  return {
    event: () => handlers.sessionListChanged(),
    harnessCatalog: (harnessIds) => handlers.harnessCatalogChanged?.(harnessIds),
    notice: (frame) => {
      if (frame.topic.kind === 'projects') {
        handlers.projectsChanged()
        return
      }
      if (frame.topic.kind === 'environment') {
        if (frame.events.some((event) => event.type === 'provider_changed')) handlers.catalogChanged?.()
        return
      }
      if (frame.snapshot !== undefined) {
        handlers.sessionListChanged()
        const { activities = [], scheduledSends } = frame.snapshot as { activities?: SessionActivity[]; scheduledSends?: ScheduledSend[] }
        if (scheduledSends) {
          const current = new Set(scheduledSends.map(row => row.sessionId))
          for (const sessionId of scheduledIds) {
            if (!current.has(sessionId)) schedule({ type: 'scheduled_send_changed', sessionId, scheduled: null, delivered: false })
          }
          for (const row of scheduledSends) schedule({ type: 'scheduled_send_changed', sessionId: row.sessionId, scheduled: row, delivered: false })
        }
        const live = new Set(activities.map((summary) => summary.sessionId))
        for (const [sessionId, summary] of [...summaries]) {
          if (live.has(sessionId)) continue
          summaries.delete(sessionId)
          if (summary.status !== 'idle') {
            publish({ type: 'session_activity', activity: { ...summary, status: 'idle', realtimeActive: false, pendingCount: 0, pendingReason: { en: null, zh: null } } })
          }
        }
        for (const summary of activities) activity({ type: 'session_activity', activity: summary })
      }
      for (const event of frame.events) {
        if (event.type === 'session_list_changed') handlers.sessionListChanged(remoteProjectKey(connectionId, event.projectPath))
        else if (event.type === 'session_activity') activity(event)
        else if (event.type === 'scheduled_send_changed') schedule(event)
      }
    },
  }
}
