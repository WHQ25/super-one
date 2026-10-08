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
import type { CollaborationPeer } from '@superone/runtime/collaboration'
import { denyMainThreadOnlyIfSubagent } from '../mcp/main-thread-session-guard'
import { acknowledgeStoppedChild, describeCollaborationChild, pendingStopKey } from './collaboration-lifecycle'
import { forwardToExternalParent } from './collaboration-external-parent'
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
  /** Peer session id. Optional for a spawn child (its parent) or a caller with one peer. */
  to?: string
  content: string
  clientMessageId?: string
}

export async function sendSessionMessage(
  callerSessionId: string,
  args: SessionSendArgs,
  host: SessionManager,
  signal?: AbortSignal,
) {
  const denied = await denyMainThreadOnlyIfSubagent(callerSessionId, 'session_collab_send')
  if (denied) return toolResult(denied, true)
  const forwarded = await forwardToExternalParent(callerSessionId, 'session_collab_send', args, signal)
  if (forwarded) return forwarded
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
    grantId: channel.grant.grant_id,
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
 * Child peers also carry what they are doing, so a woken parent can decide
 * without reading transcripts. `acks` gets the stop wakes this report
 * observes, to clear once the reply is returned.
 */
function withChildStatus(callerSessionId: string, peers: CollaborationPeer[], host: SessionManager, acks: Array<() => void>) {
  const now = Date.now()
  return Promise.all(peers.map(async (peer) => {
    if (peer.relation !== 'child') return peer
    // Read before the lookup: a stop recorded during it is not observed by this report.
    const stopKey = pendingStopKey(peer.sessionId)
    const status = await describeCollaborationChild(host, peer.sessionId, now)
    acks.push(() => acknowledgeStoppedChild(callerSessionId, peer.sessionId, status.state, stopKey))
    return { ...peer, ...status }
  }))
}

/**
 * Non-blocking mailbox read. Advances this endpoint's cursor for any messages
 * currently available and lists the caller's peers. Peers are woken via task
 * notification on send; the agent calls this after a wake, or to rediscover
 * who it can message.
 *
 * With `deferAck` the messages stay unread: it receives the acknowledgement
 * to run once the reply reached the reader, and until then a retrieve returns
 * them again.
 */
export async function retrieveSessionMessages(
  callerSessionId: string,
  args: SessionRetrieveArgs,
  host: SessionManager,
  signal?: AbortSignal,
  deferAck?: (ack: () => void) => void,
) {
  const denied = await denyMainThreadOnlyIfSubagent(callerSessionId, 'session_collab_retrieve')
  if (denied) return toolResult(denied, true)
  const forwarded = await forwardToExternalParent(callerSessionId, 'session_collab_retrieve', args, signal)
  if (forwarded) return forwarded
  let read: ReturnType<typeof readCallerMailbox>
  try {
    read = readCallerMailbox(store(), callerSessionId, { from: args.from, deferAck: Boolean(deferAck) }, sessionTitle)
  } catch (error) {
    return errorResult(error)
  }
  const { messages, acks } = read
  const observed: Array<() => void> = []
  let peers: Awaited<ReturnType<typeof withChildStatus>>
  try {
    peers = await withChildStatus(callerSessionId, read.peers, host, observed)
  } catch (error) {
    return errorResult(error)
  }
  // What the reader now has: its messages, and the stops it saw.
  const commit = () => {
    if (deferAck && messages.length > 0) store().ackMailbox(callerSessionId, acks)
    for (const ack of observed) ack()
    if (messages.length > 0) notifyCollaborationMailboxChanged(callerSessionId)
  }
  if (deferAck) deferAck(commit)
  else commit()
  if (messages.length > 0) return toolResult({ status: 'messages', messages, peers })
  return toolResult({
    status: 'empty',
    messages: [],
    peers,
    hint: peers.length > 0 ? EMPTY_MAILBOX_HINT : NO_PEERS_HINT,
  })
}
