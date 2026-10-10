import { OPERATION_SCOPES, type SessionStreamFrame } from '@superone/shared/environment'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { readTopicRef, type TopicRef, type TopicVersionCursor } from '@superone/shared/environment/topics'
import { withoutDraftAttachmentBytes } from '@superone/shared/environment/draft-content'
import { openEventStream } from './event-stream'
import { deliverFrame } from './session-delivery'
import { combineStreams, openDraftStream, openTerminalStream } from './topic-streams'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'
import type { RpcContext as HostRpcContext, RpcResult } from './rpc-context'

type RpcContext = HostRpcContext & Required<Pick<HostRpcContext, 'sessions'>>

/**
 * Push the events after `afterSequence` on this connection, then every new
 * one as it commits (`openEventStream`). Frames can precede this result, so
 * the client picks `subscriptionId`.
 */
export function handleTopicSubscribe(payload: unknown, ctx: RpcContext, servesMethod: (method: string) => boolean): RpcResult {
  const streams = ctx.streams
  if (!streams) return { error: { code: 'failed_precondition', message: 'topic.subscribe needs a socket connection' } }
  const p = asRecord(payload)
  const subscriptionId = String(p.subscriptionId ?? '').trim()
  const afterSequence = String(p.afterSequence ?? '').trim()
  if (!subscriptionId) return { error: { code: 'invalid_argument', message: 'subscriptionId required' } }
  if (!/^\d+$/.test(afterSequence)) return { error: { code: 'invalid_argument', message: 'afterSequence must be a decimal sequence' } }
  const versions = streamVersions(p.versions)
  if (versions === null) return { error: { code: 'invalid_argument', message: 'versions must map session ids to versions' } }
  const topics = readTopics(p.topics)
  if (!topics) return { error: { code: 'invalid_argument', message: 'topics must be a list of topic refs' } }
  const topicDenied = authorizeTopics(topics, ctx)
  if (topicDenied) return topicDenied
  const cursors = topicCursors(p.topicCursors)
  if (!cursors) return { error: { code: 'invalid_argument', message: 'topicCursors must map topic keys to epoch and version' } }
  const sessions = ctx.sessions
  let sentSequence = afterSequence
  const stream = openEventStream({
    source: sessions,
    environmentId: ctx.identity.environmentId,
    reader: ctx.client,
    cursor: { afterSequence, epoch: typeof p.epoch === 'string' ? p.epoch : undefined, versions },
    filter: { topics },
    push: (frame) => {
      if (!streams.delivery) {
        streams.push({ type: 'stream', subscriptionId, frame })
        return
      }
      const delivered = deliverFrame(frame, streams.delivery, sessions)
      // A frame the policy emptied says nothing new unless it moves the cursor.
      const { events, resnapshot, sequence } = delivered.frame
      if (events.length > 0 || resnapshot?.length || sequence !== sentSequence) {
        sentSequence = sequence
        streams.push({ type: 'stream', subscriptionId, frame: delivered.frame })
      }
      for (const { sessionId, update } of delivered.details) streams.push({ type: 'detail', sessionId, update })
    },
    flow: streams.flow,
    batchMs: streams.delivery && streams.delivery.policy.tier !== 'local' ? AGENT_EVENT_BATCH_MS : 0,
  })
  const terminals = ctx.terminals?.onEvent && servesMethod('terminal.attach')
    ? openTerminalStream({
        source: { onEvent: (listener) => ctx.terminals!.onEvent!(listener) },
        environmentId: ctx.identity.environmentId,
        topics,
        push: (event) => streams.push({ type: 'terminal', subscriptionId, event: ctx.terminals?.eventForClient?.(event, ctx.client.clientSessionId) ?? event }),
      })
    : null
  const drafts = !ctx.topicNotices && ctx.drafts?.watch && servesMethod('draft.list')
    ? openDraftStream({
        source: { watch: (listener) => ctx.drafts!.watch!(listener) },
        environmentId: ctx.identity.environmentId,
        topics,
        throttleSaves: streams.delivery?.policy.tier === 'relay',
        push: (event) => streams.push({ type: 'draft', subscriptionId, event }),
      })
    : null
  try {
    const notices = ctx.topicNotices?.open({ topics, cursors, policy: streams.delivery?.policy,
      snapshot: topic => snapshotTopic(topic, ctx),
      push: frame => streams.push({ type: 'topic', subscriptionId, frame }),
    }) ?? null
    streams.open(subscriptionId, combineStreams(stream, terminals, drafts, notices))
    return { result: { subscriptionId } }
  } catch (error) {
    combineStreams(stream, terminals, drafts).close()
    return mapThrown(error)
  }
}

/** A bounded cursor read for consumers joining an already shared upstream stream. */
export function handleTopicCatchUp(payload: unknown, ctx: RpcContext): RpcResult {
  const p = asRecord(payload)
  const afterSequence = String(p.afterSequence ?? '')
  const versions = streamVersions(p.versions)
  const topics = readTopics(p.topics)
  if (!/^\d+$/.test(afterSequence) || !versions || !topics) return { error: { code: 'invalid_argument', message: 'valid topic cursor required' } }
  const denied = authorizeTopics(topics, ctx)
  if (denied) return denied
  const frame: SessionStreamFrame = { sequence: afterSequence, epoch: ctx.sessions.streamEpoch(), events: [] }
  let bytes = 0
  let overflow = false
  const recovery = new Set<string>()
  // The read and cut are synchronous; no second live subscription is opened.
  const source = ctx.sessions
  const stream = openEventStream({
    source: { ...source, listEventsAfter: (after, reader) => source.listEventsAfter(after, reader),
      streamEpoch: () => source.streamEpoch(), streamingAfter: (id, version) => source.streamingAfter(id, version),
      streamingEvents: () => source.streamingEvents(), viewEvent: (event, reader) => source.viewEvent(event, reader),
      onEventsAppended: () => () => {} },
    environmentId: ctx.identity.environmentId, reader: ctx.client,
    cursor: { afterSequence, epoch: typeof p.epoch === 'string' ? p.epoch : undefined, versions },
    filter: { topics }, push: next => {
      frame.sequence = next.sequence
      for (const id of next.resnapshot ?? []) recovery.add(id)
      if (overflow) return
      bytes += Buffer.byteLength(JSON.stringify(next))
      if (bytes > 4 * 1024 * 1024) { overflow = true; frame.events = []; return }
      frame.events.push(...next.events)
    },
  })
  stream.close()
  // Filtered pages still advance the cut; no event needs to be emitted for them.
  frame.sequence = ctx.sessions.snapshotSequence()
  if (overflow) frame.recover = topics
  if (recovery.size) { frame.resnapshot = [...recovery]; frame.recover ??= topics.filter(topic => topic.kind === 'session' && recovery.has(topic.sessionId)) }
  return { result: ctx.streams?.delivery ? deliverFrame(frame, ctx.streams.delivery, ctx.sessions).frame : frame }
}

/** A stream's topics, or null when any entry is not a topic ref. An empty list is a stream that is idle for now. */
function readTopics(value: unknown): TopicRef[] | null {
  if (!Array.isArray(value)) return null
  const topics = value.map(readTopicRef)
  return topics.every((topic): topic is TopicRef => topic !== null) ? topics : null
}

/** Change an open stream's topics in place; events of added topics flow from now on. */
export function handleTopicUpdate(payload: unknown, ctx: RpcContext): RpcResult {
  const p = asRecord(payload)
  const stream = ctx.streams?.get(String(p.subscriptionId ?? '').trim())
  if (!stream) return { error: { code: 'not_found', message: 'no open stream with this subscriptionId' } }
  const topics = readTopics(p.topics)
  if (!topics) return { error: { code: 'invalid_argument', message: 'topics must be a list of topic refs' } }
  const denied = authorizeTopics(topics, ctx)
  if (denied) return denied
  stream.setTopics(topics)
  return { result: { ok: true } }
}

function authorizeTopics(topics: TopicRef[], ctx: RpcContext): RpcResult | null {
  for (const topic of topics) {
    if (topic.environmentId !== ctx.identity.environmentId) return { error: { code: 'identity_conflict', message: 'topic belongs to another environment' } }
    const scopes = topic.kind === 'projects' ? OPERATION_SCOPES.readProject
      : topic.kind === 'terminal' || topic.kind === 'terminalList' ? OPERATION_SCOPES.operateTerminal
      : topic.kind === 'environment' ? OPERATION_SCOPES.readEnvironment : OPERATION_SCOPES.readSession
    const denied = requireScopes(ctx.client, scopes)
    if (denied) return denied
  }
  return null
}

function topicCursors(value: unknown): Record<string, TopicVersionCursor> | null {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > 64 || entries.some(([, cursor]) => !cursor || typeof cursor !== 'object' || typeof cursor.epoch !== 'string' || !cursor.epoch || !Number.isSafeInteger(cursor.version) || cursor.version < 0)) return null
  return Object.fromEntries(entries)
}

/** Synchronous host reads and the host's cursor form one snapshot cut. */
function snapshotTopic(topic: TopicRef, ctx: RpcContext): unknown {
  if (topic.kind === 'projects') return { projects: ctx.projects?.list() ?? [] }
  if (topic.kind === 'drafts') return { drafts: ctx.drafts?.list().map(withoutDraftAttachmentBytes) ?? [] }
  if (topic.kind === 'sessionList') return {
    sessions: ctx.sessions.list().map(session => ({
      sessionId: session.sessionId, projectId: session.projectId, title: session.title, status: session.status,
      harnessId: session.harnessId, providerId: session.providerId, updatedAt: session.updatedAt,
      isPinned: session.isPinned, isHidden: session.isHidden,
    })),
    projects: ctx.projects?.list() ?? [],
  }
  return {}
}

/** A subscribe cursor's per-session versions, or null when malformed. */
function streamVersions(value: unknown): Record<string, number> | null {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some(([, version]) => !Number.isSafeInteger(version) || (version as number) < 0)) return null
  return Object.fromEntries(entries) as Record<string, number>
}

export function handleTopicUnsubscribe(payload: unknown, ctx: RpcContext): RpcResult {
  const subscriptionId = String(asRecord(payload).subscriptionId ?? '').trim()
  ctx.streams?.close(subscriptionId)
  return { result: { ok: true } }
}
