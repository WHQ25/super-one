import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentGateway, SessionRef } from '@superone/shared/environment'
import { sessionMessageBlocksToChatMessages } from '@superone/shared/node-message-catalog'
import { nodeHarnessToProviderId, nodePendingInteractionFields, nodeStatusToAgentStatus, type NodeSessionSnapshot } from '@superone/shared/node-session-messages'
import { extendHistoryIndex } from '@superone/shared/session-history-index'
import { projectProgressiveMessage } from '@superone/runtime/stream'

export type RoutedSessionSnapshot = NodeSessionSnapshot & { projectId: string; isHidden?: boolean }

export function routedSnapshot(snapshot: RoutedSessionSnapshot, environmentId: string, messages: ChatMessage[] = []) {
  const fields = nodePendingInteractionFields(snapshot.pendingInteraction, snapshot.pendingInputRequests)
  const pendingInteractions: AgentEvent[] = [
    ...fields.pendingPermissions.map(request => ({ type: 'permission_request' as const, request })),
    ...(fields.pendingQuestion ? [{ type: 'ask_user_question' as const, request: fields.pendingQuestion }] : []),
    ...(fields.pendingPlanApproval ? [{ type: 'plan_approval' as const, request: fields.pendingPlanApproval }] : []),
  ]
  const last = messages.findLast(message => message.role === 'assistant')
  return {
    sourceEnvironmentId: environmentId,
    status: nodeStatusToAgentStatus(snapshot.status), permissionMode: snapshot.permissionMode,
    ...(snapshot.sandboxMode ? { sandboxInfo: { enabled: snapshot.sandboxMode !== 'off', autoAllowBash: snapshot.sandboxMode === 'auto' } } : {}),
    pendingInteractions,
    inProgressMessages: snapshot.status === 'streaming' && last ? [projectProgressiveMessage({ ...last, status: 'streaming' })] : [],
  }
}

/** Catalog pages preserve native content/contexts. Details stay behind expansion. */
export async function routedHistory(gateway: EnvironmentGateway, ref: SessionRef, providerId: string, input: { cursor?: number | null; limit?: number; anchorId?: string; direction?: 'around' | 'before' | 'after' } = {}) {
  if (!gateway.sessions.listMessages) throw new Error('This host does not support session history. Upgrade it.')
  const size = Math.min(100, Math.max(1, Math.floor(input.limit ?? 24)))
  let cursor = input.cursor
  let pageLimit = size
  let totalCount: number | undefined
  let startIndex: number | undefined
  let endIndex: number | undefined
  if (input.anchorId) {
    // Find the chronological catalog position without loading the whole archive.
    let end: string | null = null
    let anchor: number | undefined
    do {
      const page = await gateway.sessions.listMessages({ session: ref, sessionId: ref.sessionId, cursor: end, limit: 100 })
      totalCount ??= (page.messages.at(-1)?.sortOrder ?? -1) + 1
      anchor = page.messages.find(message => message.id === input.anchorId)?.sortOrder
      end = page.hasMore ? page.cursor : null
    } while (anchor == null && end != null)
    if (anchor == null) throw new Error('History message no longer exists')
    startIndex = input.direction === 'before' ? Math.max(0, anchor - size)
      : input.direction === 'after' ? anchor + 1 : Math.max(0, anchor - 2)
    endIndex = Math.min(totalCount!, input.direction === 'before' ? anchor : startIndex + size)
    pageLimit = endIndex - startIndex
    cursor = endIndex
    if (pageLimit === 0) return { sessionId: ref.sessionId, messages: [], cursor: startIndex > 0 ? startIndex : null, hasMore: startIndex > 0, startIndex, endIndex, totalCount, provider: providerId, navigationAvailable: true }
  }
  const page = await gateway.sessions.listMessages({ session: ref, sessionId: ref.sessionId, cursor, limit: pageLimit })
  const messages = sessionMessageBlocksToChatMessages(page.messages, providerId)
  return { ...page, ...(startIndex == null ? {} : { startIndex, endIndex, totalCount }), cursor: page.cursor == null ? null : Number(page.cursor), messages: messages.map(projectProgressiveMessage), provider: providerId, navigationAvailable: true }
}

export async function routedDetailMessage(gateway: EnvironmentGateway, ref: SessionRef, providerId: string, messageId: string): Promise<ChatMessage> {
  if (!gateway.sessions.listMessages) throw new Error('Session details unsupported')
  let cursor: string | null = null
  do {
    const page = await gateway.sessions.listMessages({ session: ref, sessionId: ref.sessionId, cursor, limit: 100 })
    const block = page.messages.find(message => message.id === messageId)
    if (block) return sessionMessageBlocksToChatMessages([block], providerId)[0]!
    cursor = page.hasMore ? page.cursor : null
  } while (cursor != null)
  throw new Error('Detail not found')
}

export function routedHistoryIndex(snapshot: RoutedSessionSnapshot) {
  const previews: ChatMessage[] = (snapshot.transcript ?? []).flatMap(block => block.id && (block.role === 'user' || block.role === 'assistant') ? [{ id: block.id, role: block.role, status: 'complete' as const, providerId: nodeHarnessToProviderId(snapshot.harnessId), createdAt: new Date(block.createdAt ?? 0).toISOString(), content: [{ type: 'text' as const, text: (block.text ?? '').slice(0, 160) }] }] : [])
  return extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, previews)
}
