import type { SendMessageRequest } from '@superone/shared/agent-types'
import type { HarnessId, SendProviderOrigin } from './types'

export interface PendingSessionRequest {
  request: SendMessageRequest
  providerOrigin: SendProviderOrigin
  selectionRevision?: number
}

/** Resolve request settings once for both durable session state and the backend. */
export function sessionRequestSelection(
  harnessId: HarnessId,
  request: Pick<SendMessageRequest, 'model' | 'effort' | 'codex'>,
): { model?: string; effort?: SendMessageRequest['effort'] } {
  return {
    model: request.model,
    // Codex's provider-specific field wins over the generic one. Keep its exact
    // value: the shared effort type does not include Codex's minimal/ultra.
    effort: (harnessId === 'codex'
      ? request.codex?.reasoningEffort ?? request.effort
      : request.effort) as SendMessageRequest['effort'],
  }
}
