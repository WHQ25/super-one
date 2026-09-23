import type { SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { CollaborationError } from './errors'
import {
  collaborationSessionTitle,
  deriveCollaborationName,
  deriveCollaborationRole,
  parseGrantConfig,
} from './launch'
import type { CollaborationGrantRow, CollaborationStore } from './store'
import { HANDOFF_NO_MAILBOX, NO_PEERS_HINT } from './text'

/**
 * The mailbox is addressed by session id. A session may message another one
 * exactly when they share a spawn or started link grant; the host resolves the
 * calling session itself, so agents never hold a secret.
 */

export const MAX_MAILBOX_CONTENT = 100_000
export const MAX_MESSAGES_PER_RETRIEVE = 100

export type CollaborationPeerRelation = 'parent' | 'child' | 'link'

export interface CollaborationPeer {
  sessionId: string
  name: string
  role: string
  title: string
  relation: CollaborationPeerRelation
}

export interface MailboxChannel {
  grant: CollaborationGrantRow
  peer: CollaborationPeer
}

export interface MailboxMessage {
  messageId: string
  sequence: number
  fromSessionId: string
  from: CollaborationPeer
  content: string
  createdAt: string
}

/** Resolves a session's display title; null while untitled or unknown. */
export type SessionTitleLookup = (sessionId: string) => string | null

/** Human-facing identity of the launched side of a grant (agent-chosen, not the harness). */
export function describeLaunchedPeer(grant: CollaborationGrantRow): {
  name: string
  role: string
  title: string
  agentId: string
  config: SessionAgentLaunchConfig
} {
  const config = parseGrantConfig(grant.config_json)
  const name = deriveCollaborationName({ name: config.name })
  const role = deriveCollaborationRole({ role: config.role, task: grant.task })
  return { name, role, title: collaborationSessionTitle(name, role), agentId: grant.agent_id, config }
}

/** The other endpoint of a channel grant, as seen by `callerSessionId`. */
export function describePeerForCaller(
  grant: CollaborationGrantRow,
  callerSessionId: string,
  sessionTitle: SessionTitleLookup,
): CollaborationPeer {
  const relation: CollaborationPeerRelation = grant.kind === 'link'
    ? 'link'
    : callerSessionId === grant.child_session_id ? 'parent' : 'child'
  if (callerSessionId === grant.child_session_id) {
    const title = sessionTitle(grant.parent_session_id)?.trim() || grant.parent_session_id.slice(0, 8)
    return {
      sessionId: grant.parent_session_id,
      name: relation === 'parent' ? 'Parent' : title,
      role: relation === 'parent' ? '' : 'Peer',
      title,
      relation,
    }
  }
  const child = describeLaunchedPeer(grant)
  return {
    sessionId: grant.child_session_id ?? '',
    name: child.name,
    role: child.role,
    title: child.title,
    relation,
  }
}

/** Open channels of the caller, one per grant, oldest first. */
export function listMailboxChannels(
  store: CollaborationStore,
  callerSessionId: string,
  sessionTitle: SessionTitleLookup,
): MailboxChannel[] {
  return store.channelsFor(callerSessionId).map((grant) => ({
    grant,
    peer: describePeerForCaller(grant, callerSessionId, sessionTitle),
  }))
}

/** Distinct peers across channels; a later channel to the same session wins. */
export function peersOf(channels: MailboxChannel[]): CollaborationPeer[] {
  return [...new Map(channels.map((channel) => [channel.peer.sessionId, channel.peer])).values()]
}

/**
 * A link request must not open a second channel to a session that is already a
 * peer through another grant. Re-requesting the caller's own link stays
 * idempotent and is handled by the grant reuse path.
 */
export function assertNotPeeredElsewhere(
  store: CollaborationStore,
  callerSessionId: string,
  peerSessionId: string,
): void {
  const other = store.channelsFor(callerSessionId).find((grant) =>
    (grant.parent_session_id === peerSessionId || grant.child_session_id === peerSessionId)
    && !(grant.kind === 'link' && grant.parent_session_id === callerSessionId))
  if (other) {
    throw new CollaborationError(
      `Session ${peerSessionId} is already one of your collaboration peers; `
      + `message it with session_collab_send({ to: ${JSON.stringify(peerSessionId)} }).`,
      'failed_precondition',
    )
  }
}

function formatPeers(peers: CollaborationPeer[]): string {
  return peers.map((peer) => `${peer.sessionId} ("${peer.title}", ${peer.relation})`).join('; ')
}

/**
 * Pick the channel a send goes through. `to` may be omitted only when the
 * caller has exactly one peer (a spawn child always does: its parent).
 */
export function resolveSendChannel(
  store: CollaborationStore,
  callerSessionId: string,
  to: string | undefined,
  sessionTitle: SessionTitleLookup,
): MailboxChannel {
  const channels = listMailboxChannels(store, callerSessionId, sessionTitle)
  const peers = peersOf(channels)
  const target = to?.trim()
  if (!target) {
    if (peers.length === 0) throw new CollaborationError(NO_PEERS_HINT, 'failed_precondition')
    if (peers.length > 1) {
      throw new CollaborationError(
        `You have several collaboration peers; pass \`to\` with one of their session ids: ${formatPeers(peers)}`,
        'invalid_argument',
      )
    }
    return channels[channels.length - 1]
  }
  const matches = channels.filter((channel) => channel.peer.sessionId === target)
  if (matches.length > 0) return matches[matches.length - 1]
  if (store.isHandoffPair(callerSessionId, target)) {
    throw new CollaborationError(HANDOFF_NO_MAILBOX, 'failed_precondition')
  }
  throw new CollaborationError(
    `Session ${target} is not one of your collaboration peers. `
    + (peers.length > 0 ? `Your peers: ${formatPeers(peers)}` : NO_PEERS_HINT),
    'forbidden',
  )
}

export function normalizeMailboxContent(raw: unknown): string {
  const content = typeof raw === 'string' ? raw.trim() : ''
  if (!content) throw new CollaborationError('content must not be empty', 'invalid_argument')
  if (content.length > MAX_MAILBOX_CONTENT) {
    throw new CollaborationError('content may contain at most 100,000 characters', 'invalid_argument')
  }
  return content
}

/**
 * Drain the caller's unread messages (optionally only from `from` peers) and
 * list its peers. Each channel gets an even share of `limit`.
 */
export function readCallerMailbox(
  store: CollaborationStore,
  callerSessionId: string,
  options: { from?: string[]; limit?: number },
  sessionTitle: SessionTitleLookup,
): { messages: MailboxMessage[]; peers: CollaborationPeer[] } {
  const channels = listMailboxChannels(store, callerSessionId, sessionTitle)
  const peers = peersOf(channels)
  const from = options.from?.map((id) => id.trim()).filter(Boolean) ?? []
  if (from.length > 0) {
    const known = new Set(peers.map((peer) => peer.sessionId))
    const unknown = from.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      throw new CollaborationError(
        `Not your collaboration peers: ${unknown.join(', ')}. `
        + (peers.length > 0 ? `Your peers: ${formatPeers(peers)}` : NO_PEERS_HINT),
        'forbidden',
      )
    }
  }
  const selected = from.length > 0
    ? channels.filter((channel) => from.includes(channel.peer.sessionId))
    : channels
  if (selected.length === 0) return { messages: [], peers }

  const limit = Math.min(MAX_MESSAGES_PER_RETRIEVE, Math.max(1, Math.floor(options.limit ?? MAX_MESSAGES_PER_RETRIEVE)))
  const peerByGrant = new Map(selected.map((channel) => [channel.grant.grant_id, channel.peer]))
  const perGrantLimit = Math.max(1, Math.floor(limit / selected.length))
  const messages = store.readMailbox(callerSessionId, [...peerByGrant.keys()], perGrantLimit)
    .flatMap(({ grantId, rows }) => rows.map((row): MailboxMessage => ({
      messageId: row.id,
      sequence: row.sequence,
      fromSessionId: row.sender_session_id,
      from: peerByGrant.get(grantId)!,
      content: row.content,
      createdAt: row.created_at,
    })))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit)
  return { messages, peers }
}
