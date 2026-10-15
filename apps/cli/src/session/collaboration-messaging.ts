import {
  EMPTY_MAILBOX_HINT,
  NO_PEERS_HINT,
  mailboxWakeText,
  normalizeMailboxContent,
  readCallerMailbox,
  resolveSendChannel,
  type CollaborationPeer,
  type MailboxMessage,
} from '@superone/runtime/collaboration'
import type { CollaborationContext } from './collaboration-context'

export interface CollaborationSendInput {
  /** Calling endpoint; the host authorizes by it. */
  sessionId: string
  /** Peer session id. Optional for a spawn child (its parent) or a caller with one peer. */
  to?: string
  content: string
  clientMessageId?: string
}

export interface CollaborationRetrieveInput {
  /** Calling endpoint; the host authorizes by it. */
  sessionId: string
  /** Only drain messages from these peer session ids. Default: every peer. */
  from?: string[]
  max?: number
}

export interface CollaborationRetrieveResult {
  status: 'messages' | 'empty'
  messages: MailboxMessage[]
  peers: CollaborationPeer[]
  hint?: string
}

function sessionTitle(ctx: CollaborationContext) {
  return (sessionId: string) => ctx.deps.sessions.get(sessionId)?.title ?? null
}

function wakePeer(ctx: CollaborationContext, sessionId: string, fromSessionId: string, messageId: string): void {
  const fromTitle = ctx.deps.sessions.get(fromSessionId)?.title?.trim() || fromSessionId.slice(0, 8)
  ctx.wakes.enqueue(sessionId, `collab-message:${messageId}`,
    mailboxWakeText({ sessionId: fromSessionId, title: fromTitle }))
}

export function sendCollaborationMessage(ctx: CollaborationContext, input: CollaborationSendInput): {
  status: 'sent'
  messageId: string
  sequence: number
  reused: boolean
  to: CollaborationPeer
  peerSessionId: string
} {
  const channel = resolveSendChannel(ctx.store, input.sessionId, input.to, sessionTitle(ctx))
  const content = normalizeMailboxContent(input.content)
  const recipientSessionId = channel.peer.sessionId
  const insert = ctx.deps.db.transaction(() => {
    const inserted = ctx.store.appendMessage({
      grantId: channel.grant.grant_id,
      senderSessionId: input.sessionId,
      recipientSessionId,
      clientMessageId: input.clientMessageId,
      content,
    })
    wakePeer(ctx, recipientSessionId, input.sessionId, inserted.row.id)
    return inserted
  })()

  if (!insert.reused) {
    ctx.deps.events.append({
      aggregateType: 'session',
      aggregateId: input.sessionId,
      eventType: 'collaboration.message',
      payload: {
        messageId: insert.row.id,
        grantId: channel.grant.grant_id,
        toSessionId: recipientSessionId,
        sequence: insert.row.sequence,
      },
    })
  }

  return {
    status: 'sent',
    messageId: insert.row.id,
    sequence: insert.row.sequence,
    reused: insert.reused,
    to: channel.peer,
    peerSessionId: recipientSessionId,
  }
}

export function retrieveCollaborationMessages(
  ctx: CollaborationContext,
  input: CollaborationRetrieveInput,
): CollaborationRetrieveResult {
  const { messages, peers } = readCallerMailbox(
    ctx.store,
    input.sessionId,
    { from: input.from, limit: input.max },
    sessionTitle(ctx),
  )
  if (messages.length > 0) return { status: 'messages', messages, peers }
  return { status: 'empty', messages: [], peers, hint: peers.length > 0 ? EMPTY_MAILBOX_HINT : NO_PEERS_HINT }
}
