import { randomUUID } from 'node:crypto'
import {
  applyEventToSession,
  createDefaultChatCoreSession,
  createStreamingToolInputStore,
  type ChatCorePorts,
  type ChatCoreSession,
} from '@superone/chat-core'
import type { ChatMessage, HarnessId } from '@superone/shared/agent-types'
import {
  SESSION_DURABLE_EVENT,
  committedStreamingMessage,
  type EnvironmentEventEnvelope,
  type SessionLoadResult,
  type SessionLoadRequest,
} from '@superone/shared/environment'
import { activeTurnOutsidePage, sessionMessageRange } from '@superone/shared/environment/session-message-range'
import { createNodeSessionEventMapper, type NodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { sessionMessageBlocksToChatMessages } from '@superone/shared/node-message-catalog'
import { nodePendingInteractionFields } from '@superone/shared/node-session-messages'
import type { TransactionalSqliteDatabase } from '../sqlite'
import type { EventLog } from './event-log'
import { buildSessionMessageCatalog } from './message-catalog'
import type { NodeSessionRecord } from './types'

/** Idle sessions kept reduced in memory; others reload from their checkpoint. */
const MAX_IDLE_SESSIONS = 64

interface LoadedSession {
  mapper: NodeSessionEventMapper
  core: ChatCoreSession
  /** Highest version reduced into `core`. */
  applied: number
  /** Each stored message as last written, to write only what changed. */
  stored: Map<string, ChatMessage>
  storedOrder: string[]
}

/**
 * The node's read model: every session event reduced by the same chat reducer
 * the desktop and phone run, so a snapshot is what a client that saw every
 * event would show. It keeps each session in memory, including a message still
 * streaming, and checkpoints committed messages and the session state in the
 * transaction of the event that commits them. After a restart a session loads
 * from its checkpoint and replays the durable events above it; one with no
 * checkpoint (written before the read model existed) is built once from its
 * message catalog.
 */
export class SessionReadModel {
  private readonly sessions = new Map<string, LoadedSession>()
  private readonly ports: ChatCorePorts

  constructor(
    private readonly db: TransactionalSqliteDatabase,
    private readonly log: EventLog,
    private readonly records: { get(sessionId: string): NodeSessionRecord | null },
    now: () => number = Date.now,
  ) {
    this.ports = { now, id: (prefix) => `${prefix}${randomUUID()}`, streaming: createStreamingToolInputStore() }
  }

  /** Reduces one event; the log calls it before publishing (inside the transaction for durable ones). */
  apply(envelope: EnvironmentEventEnvelope): void {
    if (envelope.aggregateType !== 'session') return
    const sessionId = envelope.aggregateId
    if (envelope.eventType === SESSION_DURABLE_EVENT.removed) {
      this.forget(sessionId)
      return
    }
    const session = this.load(sessionId)
    if ((envelope.sessionVersion ?? 0) <= session.applied) return
    this.reduce(session, envelope)
    if (!envelope.ephemeral && committedStreamingMessage(envelope.eventType, envelope.payload) !== undefined) {
      this.checkpoint(sessionId, session)
    }
  }

  /** The session's state and newest messages (or those before `before`), at its current version. */
  snapshot(sessionId: string, page?: Omit<SessionLoadRequest, 'sessionId'>): SessionLoadResult {
    const session = this.load(sessionId)
    const { messages, ...state } = session.core
    const { start, end } = sessionMessageRange(messages, page)
    const activeTurn = page?.includeState === false ? [] : activeTurnOutsidePage(messages, { start, end })
    return {
      sessionId,
      state: page?.includeState === false ? {} : state as unknown as Record<string, unknown>,
      messages: messages.slice(start, end),
      ...(activeTurn.length ? { activeTurn } : {}),
      before: start > 0 ? start : null,
      after: end < messages.length ? end : null,
      cursor: { sequence: this.log.headSequence(), epoch: this.log.epoch, version: session.applied },
    }
  }

  /** The session's message still streaming, if any. */
  streamingMessageId(sessionId: string): string | null {
    return this.load(sessionId).core.messages.findLast((message) => message.status === 'streaming')?.id ?? null
  }

  /** Every message of the session, oldest first. */
  messages(sessionId: string): ChatMessage[] {
    return this.load(sessionId).core.messages
  }

  private forget(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.db.prepare(`DELETE FROM session_messages WHERE session_id = ?`).run(sessionId)
    this.db.prepare(`DELETE FROM session_read_models WHERE session_id = ?`).run(sessionId)
  }

  private reduce(session: LoadedSession, envelope: EnvironmentEventEnvelope): void {
    for (const event of session.mapper.map(envelope)) {
      session.core = { ...session.core, ...applyEventToSession(session.core, event, this.ports) }
    }
    session.applied = envelope.sessionVersion ?? session.applied
  }

  private load(sessionId: string): LoadedSession {
    const loaded = this.sessions.get(sessionId)
    if (loaded) {
      // Most recently used last, for eviction.
      this.sessions.delete(sessionId)
      this.sessions.set(sessionId, loaded)
      return loaded
    }
    this.evictIdle()
    const record = this.records.get(sessionId)
    const providerId = record?.harnessId ?? 'claude'
    const mapper = createNodeSessionEventMapper({ sessionId, providerId })
    const checkpoint = this.db
      .prepare(`SELECT applied_version, state_json FROM session_read_models WHERE session_id = ?`)
      .get(sessionId) as { applied_version: number; state_json: string } | undefined

    let session: LoadedSession
    if (checkpoint) {
      const rows = this.db
        .prepare(`SELECT message_json FROM session_messages WHERE session_id = ? ORDER BY sort_order ASC`)
        .all(sessionId) as Array<{ message_json: string }>
      const messages = rows.map((row) => JSON.parse(row.message_json) as ChatMessage)
      session = {
        mapper,
        core: { ...createDefaultChatCoreSession(), ...JSON.parse(checkpoint.state_json), messages },
        applied: checkpoint.applied_version,
        stored: new Map(messages.map((message) => [message.id, message])),
        storedOrder: messages.map((message) => message.id),
      }
      this.sessions.set(sessionId, session)
      // Durable events after the checkpoint: a turn's finished tools, its interruption.
      for (const envelope of this.log.listForSession(sessionId, Number.MAX_SAFE_INTEGER, session.applied)) {
        this.reduce(session, envelope)
      }
      return session
    }

    // Built once from the durable log as the desktop showed it before the read model.
    const events = this.log.listForSession(sessionId, Number.MAX_SAFE_INTEGER)
    const pending = nodePendingInteractionFields(record?.pendingInteraction)
    const core: ChatCoreSession = {
      ...createDefaultChatCoreSession(),
      sessionProvider: providerId as HarnessId,
      preferredProvider: providerId as HarnessId,
      messages: record ? sessionMessageBlocksToChatMessages(buildSessionMessageCatalog(record, events), providerId) : [],
      status: record?.status === 'streaming' ? 'streaming' : 'idle',
      ...pending,
    }
    session = {
      mapper,
      core,
      applied: events.at(-1)?.sessionVersion ?? 0,
      stored: new Map(),
      storedOrder: [],
    }
    this.sessions.set(sessionId, session)
    this.checkpoint(sessionId, session)
    return session
  }

  /** Drops the least recently used idle sessions; a streaming one keeps content no checkpoint has. */
  private evictIdle(): void {
    let idle = 0
    for (const session of this.sessions.values()) if (session.core.status !== 'streaming') idle++
    for (const [id, session] of this.sessions) {
      if (idle < MAX_IDLE_SESSIONS) return
      if (session.core.status === 'streaming') continue
      this.sessions.delete(id)
      idle--
    }
  }

  private checkpoint(sessionId: string, session: LoadedSession): void {
    const { messages, ...state } = session.core
    const order = messages.map((message) => message.id)
    const appendsOnly = session.storedOrder.every((id, i) => order[i] === id)
    this.db.transaction(() => {
      if (!appendsOnly) {
        this.db.prepare(`DELETE FROM session_messages WHERE session_id = ?`).run(sessionId)
        session.stored.clear()
      }
      const write = this.db.prepare(
        `INSERT OR REPLACE INTO session_messages (session_id, message_id, sort_order, message_json) VALUES (?, ?, ?, ?)`,
      )
      messages.forEach((message, i) => {
        if (session.stored.get(message.id) === message) return
        write.run(sessionId, message.id, i, JSON.stringify(message))
        session.stored.set(message.id, message)
      })
      this.db
        .prepare(
          `INSERT OR REPLACE INTO session_read_models (session_id, applied_version, state_json, updated_at) VALUES (?, ?, ?, ?)`,
        )
        .run(sessionId, session.applied, JSON.stringify(state), Date.now())
    })()
    session.storedOrder = order
  }
}

/** The `SessionRuntime` read-model option over a SQLite log: the log applies every event to it. */
export function sessionReadModel(db: TransactionalSqliteDatabase, log: EventLog) {
  return (records: { get(sessionId: string): NodeSessionRecord | null }): SessionReadModel => {
    const readModel = new SessionReadModel(db, log, records)
    log.setApplier((envelope) => readModel.apply(envelope))
    return readModel
  }
}
