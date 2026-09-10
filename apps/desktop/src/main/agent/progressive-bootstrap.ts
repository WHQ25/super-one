import type { Session } from '../session/types'
import { loadSessionMessagesPaginated } from '../db-sessions'
import { stripMessagesForRemote } from '../remote-content'
import { projectProgressiveMessage } from '../remote/progressive-session'
import { buildRemoteSessionSnapshot } from './remote-session-snapshot'

/** One round trip establishes the subscription and its first visible baseline. */
export async function buildProgressiveBootstrap(session: Session, projectPath: string, sessionId: string) {
  const page = loadSessionMessagesPaginated(sessionId, 8)
  const historyPage = { ...page, navigationAvailable: true, provider: session.snapshot.harnessId,
    messages: stripMessagesForRemote(page.messages.map(projectProgressiveMessage), projectPath) }
  const snapshot = await buildRemoteSessionSnapshot(session, projectPath, sessionId, true)
  return { ok: true, historyPage, snapshot }
}
