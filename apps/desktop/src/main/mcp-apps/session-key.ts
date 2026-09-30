import { sessionKey, sessionRef } from '@superone/shared/environment/refs'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

/** Main routing uses connection IDs; gateway descriptor IDs are a different namespace. */
export function mcpAppSessionKey(projectPath: string, sessionId: string): string {
  return sessionKey(sessionRef(parseRemoteProjectKey(projectPath)?.connectionId ?? 'local', sessionId))
}
