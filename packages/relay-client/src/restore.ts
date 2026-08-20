import type { AgentEvent, ChatMessage, RemoteCommand } from '@superone/shared/agent-types'
import type { RelayClient } from './client'

export type HistoryPage = {
  messages: ChatMessage[]
  hasMore: boolean
  cursor: number | null
  provider?: string
  error?: string
}

export type SessionSnapshot = {
  inProgressMessages?: ChatMessage[]
  pendingInteractions?: AgentEvent[]
  status?: string
  permissionMode?: string
  error?: string
}

export type RestoredSession = {
  messages: ChatMessage[]
  snapshot: SessionSnapshot
  liveBatches: unknown[][]
  epoch: number
  provider?: string
}

function rid(): string {
  return crypto.randomUUID?.() ?? `r${Date.now().toString(36)}`
}

export async function restoreSession(
  client: RelayClient,
  projectPath: string,
  sessionId: string,
): Promise<RestoredSession> {
  client.startBuffering()
  await client.request({ type: 'subscribe_session', projectPath, sessionId } as RemoteCommand)

  const messages: ChatMessage[] = []
  let cursor: number | undefined
  let provider: string | undefined
  for (let i = 0; i < 50; i++) {
    const page = await client.request({
      type: 'load_session_messages',
      requestId: rid(),
      projectPath,
      sessionId,
      limit: 50,
      ...(cursor != null ? { cursor } : {}),
    } as RemoteCommand) as HistoryPage
    if (page.error) throw new Error(page.error)
    messages.unshift(...(page.messages ?? []))
    provider = page.provider ?? provider
    if (!page.hasMore) break
    cursor = page.cursor ?? undefined
    if (cursor == null) break
  }

  const snapshot = await client.request({
    type: 'get_session_state',
    requestId: rid(),
    projectPath,
    sessionId,
  } as RemoteCommand) as SessionSnapshot
  if (snapshot.error) throw new Error(snapshot.error)

  const { epoch, batches } = client.releaseBuffer()
  return { messages, snapshot, liveBatches: batches, epoch, provider }
}
