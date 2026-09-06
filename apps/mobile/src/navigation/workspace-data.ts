import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from '../ids'
import type { TabletSessionRow } from './tablet-session-sidebar'

export async function readProjectSessions(client: RelayClient, projectPath: string): Promise<TabletSessionRow[]> {
  const result = await client.request({ type: 'list_sessions', requestId: randomId(), projectPath, limit: 30, offset: 0 } as RemoteCommand) as {
    sessions?: TabletSessionRow[]; error?: string
  }
  if (result.error) throw new Error(result.error)
  return result.sessions ?? []
}
