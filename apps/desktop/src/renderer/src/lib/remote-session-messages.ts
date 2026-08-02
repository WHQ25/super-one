import type { ChatMessage, ContentBlock, PermissionRequest } from '@superone/shared/agent-types'

export type NodeTranscriptBlock = {
  id?: string
  role?: string
  text?: string
  createdAt?: number
}

export type NodePendingInteraction = {
  interactionId: string
  kind?: 'permission' | 'question' | 'plan'
  toolName?: string
  toolUseId?: string
  input?: Record<string, unknown>
  createdAt?: number
}

export type NodeSessionSnapshot = {
  sessionId?: string
  title?: string | null
  status?: string
  harnessId?: string
  providerId?: string
  transcript?: NodeTranscriptBlock[]
  pendingInteraction?: NodePendingInteraction | null
  updatedAt?: number
}

/** Map node pending permission into desktop PermissionRequest for the prompt UI. */
export function nodePendingToPermissionRequest(
  pending: NodePendingInteraction | null | undefined,
): PermissionRequest | null {
  if (!pending?.interactionId) return null
  if (pending.kind && pending.kind !== 'permission') return null
  return {
    requestId: pending.interactionId,
    toolName: pending.toolName || 'tool',
    toolUseId: pending.toolUseId,
    input: pending.input && typeof pending.input === 'object' ? pending.input : {},
    allowAlwaysAllow: true,
  }
}

/** Map node SessionRuntime transcript blocks into desktop ChatMessage rows. */
export function transcriptToChatMessages(
  transcript: NodeTranscriptBlock[] | undefined,
  providerId = 'codex',
): ChatMessage[] {
  if (!Array.isArray(transcript)) return []
  const out: ChatMessage[] = []
  for (const block of transcript) {
    const role = block.role === 'assistant' || block.role === 'user' ? block.role : null
    if (!role) continue
    const text = typeof block.text === 'string' ? block.text : ''
    const content: ContentBlock[] = text
      ? [{ type: 'text', text }]
      : []
    out.push({
      id: block.id || crypto.randomUUID(),
      role,
      status: 'complete',
      content,
      createdAt: block.createdAt
        ? new Date(block.createdAt).toISOString()
        : new Date().toISOString(),
      providerId,
    })
  }
  return out
}

/**
 * Merge node transcript (text-only recovery) with locally streamed messages.
 *
 * Matching rule — role-index, not id equality:
 * Walk transcript order; for the nth user / nth assistant row, if a local
 * message of the same role exists at that role-index, keep the local message
 * (rich tool_use / tool_result / thinking blocks win). Otherwise insert the
 * transcript-derived row (stream missed it). Unmatched local messages (e.g.
 * optimistic user not yet on the node) are appended in their original order.
 *
 * Why not id: the renderer echoes the user bubble under `clientMessageId`
 * while the node uses its own blockId (`skipUserMessage: true`), and
 * `createNodeSessionEventMapper` uses a sticky assistant id per turn that
 * diverges from SessionRuntime transcript assistant ids.
 */
export function reconcileTranscriptWithLocalMessages(
  localMessages: ChatMessage[],
  transcript: NodeTranscriptBlock[] | undefined,
  providerId = 'codex',
): ChatMessage[] {
  const recovery = transcriptToChatMessages(transcript, providerId)
  if (recovery.length === 0) return localMessages
  if (localMessages.length === 0) return recovery

  const localByRole: { user: number[]; assistant: number[] } = {
    user: [],
    assistant: [],
  }
  for (let i = 0; i < localMessages.length; i++) {
    const role = localMessages[i]!.role
    if (role === 'user' || role === 'assistant') {
      localByRole[role].push(i)
    }
  }

  const roleCursor = { user: 0, assistant: 0 }
  const usedLocal = new Set<number>()
  const result: ChatMessage[] = []

  for (const rec of recovery) {
    const role = rec.role
    const idxInRole = roleCursor[role]
    const localIdx = localByRole[role][idxInRole]
    if (localIdx !== undefined) {
      roleCursor[role] = idxInRole + 1
      usedLocal.add(localIdx)
      result.push(localMessages[localIdx]!)
    } else {
      result.push(rec)
    }
  }

  for (let i = 0; i < localMessages.length; i++) {
    if (!usedLocal.has(i)) {
      result.push(localMessages[i]!)
    }
  }

  return result
}

export function nodeStatusToAgentStatus(
  status: string | undefined,
): 'idle' | 'streaming' | 'error' {
  if (status === 'streaming') return 'streaming'
  if (status === 'error') return 'error'
  return 'idle'
}

/** Normalize node harnessId into a chat session provider id. */
export function nodeHarnessToProviderId(harnessId: string | undefined | null): string {
  if (harnessId === 'claude' || harnessId === 'codex' || harnessId === 'acp' || harnessId === 'opencode') {
    return harnessId
  }
  return harnessId || 'claude'
}
