import type { AgentEvent } from '@superone/shared/agent-types'

/**
 * A node voice signal carries the node's filesystem path. The desktop chat
 * watches `remote:<connectionId>:<path>`, which is what the topic router reads.
 */
export function desktopVoiceSignal(event: AgentEvent, remoteProjectPath: string | undefined): AgentEvent | null {
  if (event.type !== 'realtime_call_signal' || !event.sessionId) return null
  const projectPath = remoteProjectPath ?? event.projectPath
  return { ...event, sessionId: event.sessionId, ...(projectPath ? { projectPath } : {}) }
}
