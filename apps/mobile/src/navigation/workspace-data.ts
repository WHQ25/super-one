import type { RelayClient } from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from '../ids'
import type { SessionListRow } from '../session-list-state'

/** One list request's worth of rows, plus how many the project has in total. */
export type SessionPage = { sessions: SessionListRow[]; totalCount: number }

export const SESSION_PAGE_SIZE = 30

export async function readProjectSessions(
  client: RelayClient,
  projectPath: string,
  { limit = SESSION_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<SessionPage> {
  const result = await client.request({
    type: 'list_sessions', requestId: randomId(), projectPath, limit, offset,
  } as RemoteCommand) as { sessions?: SessionListRow[]; totalCount?: number; error?: string }
  if (result.error) throw new Error(result.error)
  const sessions = result.sessions ?? []
  // An older desktop omits totalCount; a full page then implies there is more.
  return { sessions, totalCount: result.totalCount ?? offset + sessions.length + (sessions.length === limit ? 1 : 0) }
}

/** Every pinned session across the host's projects, most recent first. */
export async function readPinnedSessions(client: RelayClient): Promise<SessionListRow[]> {
  return crossProjectSessions(client, { type: 'list_pinned_sessions', requestId: randomId() })
}

/** Host-side title search across every project; `query` must already be trimmed. */
export async function searchSessions(
  client: RelayClient,
  query: string,
  limit = 50,
): Promise<SessionListRow[]> {
  return crossProjectSessions(client, { type: 'search_sessions', requestId: randomId(), query, limit })
}

/** One session by id from any project; null when the host has no such row. */
export async function findSession(client: RelayClient, sessionId: string): Promise<SessionListRow | null> {
  const result = await client.request({ type: 'find_session', requestId: randomId(), sessionId } as RemoteCommand) as {
    session?: SessionListRow | null; error?: string
  }
  if (result.error) throw new Error(result.error)
  return result.session ?? null
}

async function crossProjectSessions(client: RelayClient, command: unknown): Promise<SessionListRow[]> {
  const result = await client.request(command as RemoteCommand) as {
    sessions?: SessionListRow[]; error?: string
  }
  if (result.error) throw new Error(result.error)
  // A desktop older than these commands answers nothing at all; an empty list is
  // the honest rendering of "this host cannot tell us".
  return result.sessions ?? []
}
