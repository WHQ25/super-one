import {
  CollaborationError,
  EMPTY_MAILBOX_HINT,
  MAX_MESSAGES_PER_RETRIEVE,
  assertMailboxEndpoint,
  hashCollaborationCredential,
  mailboxWakeText,
  normalizeMailboxContent,
  resolveMailboxRecipient,
} from '@superone/runtime/collaboration'
import type { CollaborationContext } from './collaboration-context'

export interface CollaborationSendInput {
  credential: string
  content: string
  clientMessageId?: string
  /** Calling endpoint (parent or child). */
  sessionId: string
}

export interface CollaborationRetrieveInput {
  credential?: string
  /** Desktop/MCP tool shape: drain several mailboxes in one call. */
  credentials?: string[]
  sessionId: string
  max?: number
}

export interface CollaborationRetrieveResult {
  status: 'messages' | 'empty'
  messages: Array<{
    messageId: string
    sequence: number
    fromSessionId: string
    content: string
    createdAt: string
    credential?: string
  }>
  hint?: string
}

async function wakePeer(ctx: CollaborationContext, sessionId: string, credential: string): Promise<void> {
  if (!ctx.deps.sessions.get(sessionId)) return
  try {
    // Host-origin task_notification: full credential reaches the model;
    // SessionRuntime redacts it in the durable transcript (desktop parity).
    await ctx.deps.sessions.sendWithoutLease({
      sessionId,
      text: mailboxWakeText(credential),
      source: 'task-notification',
      requestId: `collab-wake-${hashCollaborationCredential(credential).slice(0, 12)}-${Date.now()}`,
    })
  } catch {
    /* best-effort */
  }
}

export function sendCollaborationMessage(ctx: CollaborationContext, input: CollaborationSendInput): {
  status: 'sent'
  messageId: string
  sequence: number
  reused: boolean
  peerSessionId: string
} {
  const grant = ctx.store.grantByCredential(input.credential)
  if (!grant) throw new CollaborationError('Invalid collaboration credential', 'not_found')
  const recipientSessionId = resolveMailboxRecipient(grant, input.sessionId)
  const content = normalizeMailboxContent(input.content)
  const insert = ctx.store.appendMessage({
    credentialHash: grant.credential_hash,
    senderSessionId: input.sessionId,
    recipientSessionId,
    clientMessageId: input.clientMessageId,
    content,
  })

  if (!insert.reused) {
    ctx.deps.events.append({
      aggregateType: 'session',
      aggregateId: input.sessionId,
      eventType: 'collaboration.message',
      payload: {
        messageId: insert.row.id,
        grantId: grant.credential_hash,
        toSessionId: recipientSessionId,
        sequence: insert.row.sequence,
      },
    })
    // Best-effort peer wake via host-initiated turn (non-blocking).
    void wakePeer(ctx, recipientSessionId, input.credential)
  }

  return {
    status: 'sent',
    messageId: insert.row.id,
    sequence: insert.row.sequence,
    reused: insert.reused,
    peerSessionId: recipientSessionId,
  }
}

export function retrieveCollaborationMessages(
  ctx: CollaborationContext,
  input: CollaborationRetrieveInput,
): CollaborationRetrieveResult {
  const credentials = [
    ...(typeof input.credential === 'string' && input.credential.trim() ? [input.credential.trim()] : []),
    ...(Array.isArray(input.credentials)
      ? input.credentials.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : []),
  ]
  if (credentials.length === 0) throw new CollaborationError('credentials required', 'invalid_argument')

  const max = Math.min(
    MAX_MESSAGES_PER_RETRIEVE,
    Math.max(1, typeof input.max === 'number' && Number.isFinite(input.max) ? Math.floor(input.max) : MAX_MESSAGES_PER_RETRIEVE),
  )
  const credentialByHash = new Map(credentials.map((credential) => {
    const grant = ctx.store.grantByCredential(credential)
    if (!grant) throw new CollaborationError('Invalid collaboration credential', 'not_found')
    assertMailboxEndpoint(grant, input.sessionId)
    return [grant.credential_hash, credential] as const
  }))
  const messages = ctx.store.readMailbox(input.sessionId, [...credentialByHash.keys()], max)
    .flatMap(({ credentialHash, rows }) => rows.map((row) => ({
      messageId: row.id,
      sequence: row.sequence,
      fromSessionId: row.sender_session_id,
      content: row.content,
      createdAt: row.created_at,
      ...(credentials.length > 1 ? { credential: credentialByHash.get(credentialHash)! } : {}),
    })))

  if (messages.length === 0) return { status: 'empty', messages: [], hint: EMPTY_MAILBOX_HINT }
  return { status: 'messages', messages }
}
