import { codexThreadSettingsParams } from '@superone/shared/realtime-voice-codex'
import type { AppServerConnection } from './app-server-connection'
import type { CodexSession } from './codex-session'

/** Realtime delegates inside app-server, without a client-issued turn/start. */
export async function syncCodexThreadSelection(
  connection: AppServerConnection,
  threadId: string,
  session: Pick<CodexSession, 'model' | 'modelReasoningEffort' | 'serviceTier'>,
): Promise<void> {
  await connection.request('thread/settings/update', codexThreadSettingsParams(threadId, {
    model: session.model,
    effort: session.modelReasoningEffort,
    serviceTier: session.serviceTier,
  }))
}
