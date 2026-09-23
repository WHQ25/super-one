/**
 * session_collab_send / session_collab_retrieve: the durable mailbox between
 * a parent and its spawn child, or between link peers.
 */

import {
  EMPTY_MAILBOX_HINT,
  assertMailboxEndpoint,
  normalizeMailboxContent,
  readOnlyTargetMessage as collaborationTargetReadOnlyMessage,
  resolveMailboxRecipient,
  type CollaborationGrantRow as GrantRow,
} from '@superone/runtime/collaboration'
import {
  collaborationStore as store,
  notifyCollaborationMailboxChanged,
  readCollaborationMailbox,
} from './collaboration-mailbox'
import {
  describePeerForCaller,
  errorResult,
  isCollaborationTargetReadOnly,
  toolResult,
  wakeCollaborationPeer,
} from './collaboration-host'
import type { SessionManager } from './types'

export interface SessionSendArgs {
  credential: string
  content: string
  clientMessageId?: string
}

export async function sendSessionMessage(
  callerSessionId: string,
  args: SessionSendArgs,
  host: SessionManager,
) {
  const grants = store()
  const grant = grants.grantByCredential(args.credential)
  if (!grant) return toolResult({ status: 'error', message: 'Invalid collaboration credential' }, true)
  let recipientSessionId: string
  let content: string
  try {
    recipientSessionId = resolveMailboxRecipient(grant, callerSessionId)
    content = normalizeMailboxContent(args.content)
  } catch (error) {
    return errorResult(error)
  }

  const liveRecipient = host.getSession(recipientSessionId)
  if (isCollaborationTargetReadOnly(recipientSessionId, liveRecipient)) {
    return toolResult({
      status: 'error',
      message: collaborationTargetReadOnlyMessage(recipientSessionId),
    }, true)
  }

  const insert = grants.appendMessage({
    credentialHash: grant.credential_hash,
    senderSessionId: callerSessionId,
    recipientSessionId,
    clientMessageId: args.clientMessageId,
    content,
  })
  if (!insert.reused) {
    notifyCollaborationMailboxChanged(recipientSessionId)
    // Mailbox traffic is already visible via session_send / session_retrieve tool UI.
    // Do not also inject collab transcript bubbles (that doubled the UI).
    void wakeCollaborationPeer(host, recipientSessionId, args.credential)
  }
  const peer = describePeerForCaller(grant, callerSessionId)
  return toolResult({
    status: 'sent',
    messageId: insert.row.id,
    sequence: insert.row.sequence,
    reused: insert.reused,
    to: peer,
    peerSessionId: recipientSessionId,
  })
}

export interface SessionRetrieveArgs {
  credentials: string[]
}

/**
 * Non-blocking mailbox read. Advances this endpoint's cursor for any messages
 * currently available. Peers are woken via task notification on send; the agent
 * should call this after a wake (or when it otherwise wants to drain the inbox).
 */
export async function retrieveSessionMessages(
  callerSessionId: string,
  args: SessionRetrieveArgs,
) {
  if (!Array.isArray(args.credentials) || args.credentials.length === 0) {
    return toolResult({ status: 'error', message: 'credentials must not be empty' }, true)
  }
  if (args.credentials.length > 32) {
    return toolResult({ status: 'error', message: 'At most 32 credentials may be retrieved at once' }, true)
  }

  const grantStore = store()
  let grants: Array<GrantRow & { credential: string }>
  try {
    grants = [...new Set(args.credentials)].map((credential) => {
      const grant = grantStore.grantByCredential(credential)
      if (!grant) throw new Error('Invalid collaboration credential')
      assertMailboxEndpoint(grant, callerSessionId)
      return { ...grant, credential }
    })
  } catch (error) {
    return errorResult(error)
  }

  const peers = grants.map((grant) => ({
    credential: grant.credential,
    ...describePeerForCaller(grant, callerSessionId),
  }))

  const messages = readCollaborationMailbox(callerSessionId, grants.map((grant) => ({
    credentialHash: grant.credential_hash,
    credential: grant.credential,
    peer: describePeerForCaller(grant, callerSessionId),
  })))
  if (messages.length > 0) {
    notifyCollaborationMailboxChanged(callerSessionId)
    return toolResult({ status: 'messages', messages, peers })
  }
  return toolResult({ status: 'empty', messages: [], peers, hint: EMPTY_MAILBOX_HINT })
}
