import type { RelayClient } from '@superone/relay-client'
import type { NativeActionPorts } from './native-actions'
import { runtimeSessionRef } from './runtime-session-rpc'
import type { SuggestedTaskLaunchChoice, SuggestedTaskLaunchOptions } from '@superone/shared/suggested-task'

export interface SuggestedTaskLaunchRequest {
  /** `force` re-probes the host catalog instead of reading its cache. */
  loadOptions(force?: boolean): Promise<SuggestedTaskLaunchOptions>
  launch(choice: SuggestedTaskLaunchChoice): Promise<{ sessionId: string }>
}

/** Only native owns the session target; the document can name a card, not another session. */
export function createSuggestedTaskActions(context: () => {
  client: RelayClient | null
  owner: { sessionId: string; sourceEnvironmentId: string | null } | null
}, present: (request: SuggestedTaskLaunchRequest) => void): Pick<NativeActionPorts, 'launchSuggestedTask'> {
  return {
    launchSuggestedTask: async taskId => {
      const { client, owner } = context()
      if (!client || !owner) throw new Error('No active session')
      const ref = runtimeSessionRef(client, owner.sessionId, owner.sourceEnvironmentId)
      present({
        loadOptions: (force) => client.rpc('session.suggestedTaskLaunchOptions', {
          sessionId: ref.sessionId, taskId, ...(force ? { force: true } : {}),
        }, { environmentId: ref.environmentId }),
        launch: choice => client.controlledRpc(ref, 'session.launchSuggestedTask', { taskId, choice }, { timeoutMs: 120_000 }),
      })
    },
  }
}
