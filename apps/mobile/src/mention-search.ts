import type { RelayClient } from '@superone/relay-client'
import { randomId } from './ids'

export type MentionSearchResult = { items?: unknown[]; agentTargets?: unknown; capabilityIds?: unknown; error?: string }

/** Works before session creation as well as inside an active chat. */
export function requestMentionSearch(client: Pick<RelayClient, 'request'>, projectPath: string, query: string): Promise<MentionSearchResult> {
  return client.request({ type: 'search_mentions', requestId: randomId(), projectPath, query }) as Promise<MentionSearchResult>
}
