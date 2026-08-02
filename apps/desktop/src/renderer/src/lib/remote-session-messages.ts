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
 * Matching rule:
 * 1. **Assistants — match by id.** SessionRuntime allocates one `assistantId`
 *    per turn and threads it through the harness mapper into streamed
 *    `message_start` / deltas *and* (on success only) the transcript block id.
 *    Same string on both sides. If the id is already local, keep the local
 *    message (rich tool_use / tool_result / thinking). If not, insert the
 *    transcript row (stream missed it).
 * 2. **Users — never replace, only fill gaps.** Renderer user bubbles use
 *    `clientMessageId` while the node uses its own blockId (`skipUserMessage`),
 *    so ids diverge. User content is plain text on both sides; use surrounding
 *    matched assistant ids as anchors and insert a transcript user only when
 *    no local user sits in that gap.
 * 3. **Never drop a local-only message.** Interrupted / error turns never push
 *    an assistant block to the transcript, but the renderer already streamed
 *    one — those must survive reconcile.
 */
export function reconcileTranscriptWithLocalMessages(
  localMessages: ChatMessage[],
  transcript: NodeTranscriptBlock[] | undefined,
  providerId = 'codex',
): ChatMessage[] {
  const recovery = transcriptToChatMessages(transcript, providerId)
  if (recovery.length === 0) return localMessages
  if (localMessages.length === 0) return recovery

  const localById = new Map<string, number>()
  for (let i = 0; i < localMessages.length; i++) {
    localById.set(localMessages[i]!.id, i)
  }

  const transcriptAssistantIds = new Set<string>()
  for (const m of recovery) {
    if (m.role === 'assistant') transcriptAssistantIds.add(m.id)
  }

  const usedLocal = new Set<number>()
  const result: ChatMessage[] = []
  let localIdx = 0

  const takeLocal = (i: number) => {
    if (usedLocal.has(i)) return
    usedLocal.add(i)
    result.push(localMessages[i]!)
  }

  /** Emit unused local messages from localIdx while shouldTake is true. */
  const flushWhile = (shouldTake: (m: ChatMessage) => boolean) => {
    while (localIdx < localMessages.length) {
      if (usedLocal.has(localIdx)) {
        localIdx++
        continue
      }
      const m = localMessages[localIdx]!
      if (!shouldTake(m)) break
      takeLocal(localIdx)
      localIdx++
    }
  }

  for (let ti = 0; ti < recovery.length; ti++) {
    const rec = recovery[ti]!

    if (rec.role === 'assistant') {
      // Users + interrupted/error assistants (not on transcript) before this id.
      flushWhile((m) => {
        if (m.id === rec.id) return false
        if (m.role === 'assistant' && transcriptAssistantIds.has(m.id)) return false
        return true
      })

      const localAt = localById.get(rec.id)
      if (localAt !== undefined) {
        takeLocal(localAt)
        if (localIdx <= localAt) localIdx = localAt + 1
      } else {
        // Stream missed this assistant — recover text-only from transcript.
        result.push(rec)
      }
      continue
    }

    // User: insert only when the gap before the next transcript assistant has
    // no local user (ids never match across the client/node boundary).
    let nextAsstId: string | null = null
    for (let k = ti + 1; k < recovery.length; k++) {
      if (recovery[k]!.role === 'assistant') {
        nextAsstId = recovery[k]!.id
        break
      }
    }

    let hasLocalUserInGap = false
    for (let j = localIdx; j < localMessages.length; j++) {
      if (usedLocal.has(j)) continue
      const m = localMessages[j]!
      if (nextAsstId && m.id === nextAsstId) break
      if (m.role === 'assistant' && transcriptAssistantIds.has(m.id)) break
      if (m.role === 'user') {
        hasLocalUserInGap = true
        break
      }
    }

    if (hasLocalUserInGap) {
      flushWhile((m) => m.role === 'assistant' && !transcriptAssistantIds.has(m.id))
      while (localIdx < localMessages.length) {
        if (usedLocal.has(localIdx)) {
          localIdx++
          continue
        }
        if (localMessages[localIdx]!.role === 'user') {
          takeLocal(localIdx)
          localIdx++
        }
        break
      }
    } else {
      result.push(rec)
    }
  }

  // Local-only messages (interrupted/error assistants, trailing optimistic users).
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
