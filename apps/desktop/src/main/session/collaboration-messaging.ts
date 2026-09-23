/**
 * session_collab_send / session_collab_retrieve: the durable mailbox between
 * a parent and its spawn child, or between link peers. The host authorizes by
 * the calling session; peers are addressed by session id.
 */

import {
  EMPTY_MAILBOX_HINT,
  NO_PEERS_HINT,
  normalizeMailboxContent,
  readCallerMailbox,
  readOnlyTargetMessage as collaborationTargetReadOnlyMessage,
  resolveSendChannel,
} from '@superone/runtime/collaboration'
import { denyMainThreadOnlyIfSubagent } from '../mcp/main-thread-session-guard'
import { collaborationStore as store, notifyCollaborationMailboxChanged } from './collaboration-mailbox'
import {
  errorResult,
  isCollaborationTargetReadOnly,
  sessionTitle,
  toolResult,
  wakeCollaborationPeer,
} from './collaboration-host'
import type { SessionManager } from './types'

export interface SessionSendArgs {
  /** Peer session id. Optional when the caller has exactly one peer. */
  to?: string
  content: string
  clientMessageId?: string
}

export async function sendSessionMessage(
  callerSessionId: string,
  args: SessionSendArgs,
  host: SessionManager,
) {
  const denied = denyMainThreadOnlyIfSubagent(callerSessionId, 'session_collab_send')
  if (denied) return toolResult(denied, true)
  const grants = store()
  let channel: ReturnType<typeof resolveSendChannel>
  let content: string
  try {
    channel = resolveSendChannel(grants, callerSessionId, args.to, sessionTitle)
    content = normalizeMailboxContent(args.content)
  } catch (error) {
    return errorResult(error)
  }
  const recipientSessionId = channel.peer.sessionId

  const liveRecipient = host.getSession(recipientSessionId)
  if (isCollaborationTargetReadOnly(recipientSessionId, liveRecipient)) {
    return toolResult({
      status: 'error',
      message: collaborationTargetReadOnlyMessage(recipientSessionId),
    }, true)
  }

  const insert = grants.appendMessage({
    credentialHash: channel.grant.credential_hash,
    senderSessionId: callerSessionId,
    recipientSessionId,
    clientMessageId: args.clientMessageId,
    content,
  })
  if (!insert.reused) {
    notifyCollaborationMailboxChanged(recipientSessionId)
    // Mailbox traffic is already visible via session_send / session_retrieve tool UI.
    // Do not also inject collab transcript bubbles (that doubled the UI).
    void wakeCollaborationPeer(host, recipientSessionId, callerSessionId)
  }
  return toolResult({
    status: 'sent',
    messageId: insert.row.id,
    sequence: insert.row.sequence,
    reused: insert.reused,
    to: channel.peer,
    peerSessionId: recipientSessionId,
  })
}

export interface SessionRetrieveArgs {
  /** Only drain messages from these peer session ids. Default: every peer. */
  from?: string[]
}

/**
 * Non-blocking mailbox read. Advances this endpoint's cursor for any messages
 * currently available and lists the caller's peers. Peers are woken via task
 * notification on send; the agent calls this after a wake, or to rediscover
 * who it can message.
 */
export async function retrieveSessionMessages(
  callerSessionId: string,
  args: SessionRetrieveArgs,
) {
  const denied = denyMainThreadOnlyIfSubagent(callerSessionId, 'session_collab_retrieve')
  if (denied) return toolResult(denied, true)
  let read: ReturnType<typeof readCallerMailbox>
  try {
    read = readCallerMailbox(store(), callerSessionId, { from: args.from }, sessionTitle)
  } catch (error) {
    return errorResult(error)
  }
  const { messages, peers } = read
  if (messages.length > 0) {
    notifyCollaborationMailboxChanged(callerSessionId)
    return toolResult({ status: 'messages', messages, peers })
  }
  return toolResult({
    status: 'empty',
    messages: [],
    peers,
    hint: peers.length > 0 ? EMPTY_MAILBOX_HINT : NO_PEERS_HINT,
  })
}
