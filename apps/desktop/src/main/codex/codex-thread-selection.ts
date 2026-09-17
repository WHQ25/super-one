import type { AppServerConnection } from './app-server-connection'
import type { CodexSession } from './codex-session'

/** Realtime delegates inside app-server, without a client-issued turn/start. */
export async function syncCodexThreadSelection(
  connection: AppServerConnection,
  threadId: string,
  session: Pick<CodexSession, 'model' | 'modelReasoningEffort' | 'serviceTier'>,
): Promise<void> {
  await connection.request('thread/settings/update', {
    threadId,
    ...(session.model ? { model: session.model } : {}),
    ...(session.modelReasoningEffort ? { effort: session.modelReasoningEffort, summary: 'concise' } : {}),
    // Omission retains the old tier; explicit null turns Fast off.
    serviceTier: session.serviceTier,
  })
}
