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
