import type { Session } from '../session/types'
import { loadSessionMessagesPaginated } from '../db-sessions'
import { whenHighlighterReady } from '../remote-highlighter'
import type { ConnectionDelivery } from '@superone/runtime/stream'
import { buildRemoteSessionSnapshot } from './remote-session-snapshot'

/**
 * One round trip establishes the subscription and its first visible baseline,
 * under the asking connection's delivery (summarized: it opened the session so).
 */
export async function buildProgressiveBootstrap(session: Session, projectPath: string, sessionId: string, delivery: ConnectionDelivery) {
  await whenHighlighterReady()
  const page = loadSessionMessagesPaginated(sessionId, 8)
  const historyPage = { ...page, navigationAvailable: true, provider: session.snapshot.harnessId,
    messages: delivery.messages(page.messages, sessionId, projectPath) }
  const snapshot = await buildRemoteSessionSnapshot(session, projectPath, sessionId, delivery)
  return { ok: true, historyPage, snapshot }
}
