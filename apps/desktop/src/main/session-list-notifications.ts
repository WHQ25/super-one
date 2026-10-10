import type { AgentEvent } from '@superone/shared/agent-types'
import { watchSessionList } from './session-list-watch'

/** Durable list mutations must invalidate both desktop windows and paired phones. */
export function bindSessionListNotifications(
  desktopChanged: (projectPath: string) => void,
  remoteEvent: (event: AgentEvent) => void,
): () => void {
  return watchSessionList(projectPath => {
    desktopChanged(projectPath)
    remoteEvent({ type: 'session_list_changed', projectPath })
  })
}
