import type { AgentEvent } from '@superone/shared/agent-types'
import { remoteProjectKey } from '@superone/shared/remote-resource-key'
import type { SessionActivity } from '@superone/shared/session-activity'
import type { RemoteListObserver } from './remote-session-feed'

export type SessionActivityEvent = Extract<AgentEvent, { type: 'session_activity' }>

/** What this desktop does with a node's list changes, in its own project keys (`remote:<connectionId>:<path>`). */
export interface RemoteListHandlers {
  /** A project's session list changed, or, without a key, any of them. */
  sessionListChanged(projectKey?: string): void
  projectsChanged(): void
  /** A session's sidebar summary (running, read). */
  activity(event: SessionActivityEvent): void
}

/**
 * Reads a node's list topics the way its phones do: `session_list_changed`
 * names the project to re-read, `session_activity` carries a row's live
 * state, and a snapshot (a fresh subscribe, or changes the node no longer
 * holds) re-reads everything and reseeds the summaries.
 */
export function remoteListObserver(connectionId: string, handlers: RemoteListHandlers): RemoteListObserver {
  const activity = (event: SessionActivityEvent) => handlers.activity({
    ...event, activity: { ...event.activity, projectPath: remoteProjectKey(connectionId, event.activity.projectPath) },
  })
  return {
    event: () => handlers.sessionListChanged(),
    notice: (frame) => {
      if (frame.topic.kind === 'projects') {
        handlers.projectsChanged()
        return
      }
      if (frame.snapshot !== undefined) {
        handlers.sessionListChanged()
        const { activities } = frame.snapshot as { activities?: SessionActivity[] }
        for (const summary of activities ?? []) activity({ type: 'session_activity', activity: summary })
      }
      for (const event of frame.events) {
        if (event.type === 'session_list_changed') handlers.sessionListChanged(remoteProjectKey(connectionId, event.projectPath))
        else if (event.type === 'session_activity') activity(event)
      }
    },
  }
}
