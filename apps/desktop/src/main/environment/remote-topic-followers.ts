import type { SessionStreamFrame, TopicSubscribeInput } from '@superone/shared/environment'
import { TERMINAL_LIST_EVENT_TYPES, topicKey, type TopicRef } from '@superone/shared/environment/topics'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { streamFilterMatcher } from '@superone/runtime/server/event-stream'

export interface RemoteTopicStream { close(): void; update(topics: TopicRef[]): Promise<void> }
interface Follower {
  topics: TopicRef[]
  handlers: RpcStreamHandlers
  cursor: { sequence: string; epoch?: string; versions: Record<string, number> }
  pending: SessionStreamFrame[] | null
  bytes: number
  overflow: boolean
  closed: boolean
}

/** Native readers join the node's existing stream at a cursor, holding live frames during the cut. */
export class RemoteTopicFollowers {
  private readonly readers = new Set<Follower>()
  constructor(private readonly applyInterest: () => Promise<void>) {}

  topics(): TopicRef[] { return [...new Map([...this.readers].flatMap(reader => reader.topics).map(topic => [topicKey(topic), topic])).values()] }

  async open(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers,
    join: () => Promise<void>, catchUp: () => Promise<SessionStreamFrame>): Promise<RemoteTopicStream> {
    const reader: Follower = { topics: input.topics, handlers, cursor: {
      sequence: input.afterSequence, epoch: input.epoch, versions: { ...input.versions },
    }, pending: [], bytes: 0, overflow: false, closed: false }
    this.readers.add(reader)
    const close = () => { reader.closed = true; if (this.readers.delete(reader)) void this.applyInterest().catch(() => {}) }
    try {
      await join()
      if (reader.closed) throw new Error('topic stream closed')
      const cut = await catchUp()
      if (reader.closed) throw new Error('topic stream closed')
      this.deliver(reader, cut)
      const held = reader.pending!
      reader.pending = null
      if (reader.overflow || held.some(frame => frame.epoch !== cut.epoch)) this.recover(reader)
      else for (const frame of held) this.deliver(reader, frame)
      return { close, update: async topics => {
        if (reader.closed) throw new Error('topic stream closed')
        const previous = reader.topics
        reader.topics = topics
        try { await this.applyInterest() }
        catch (error) {
          if (reader.topics === topics) { reader.topics = previous; void this.applyInterest().catch(() => {}) }
          throw error
        }
      } }
    } catch (error) { close(); throw error }
  }

  frame(frame: SessionStreamFrame): void {
    for (const reader of [...this.readers]) {
      if (reader.pending) {
        if (reader.overflow) continue
        reader.bytes += Buffer.byteLength(JSON.stringify(frame))
        if (reader.bytes > 4 * 1024 * 1024 || reader.pending.length >= 1024) {
          reader.pending = []; reader.overflow = true
        } else reader.pending.push(frame)
      } else this.deliver(reader, frame)
    }
  }

  terminal(event: Parameters<NonNullable<RpcStreamHandlers['onTerminal']>>[0]): void {
    for (const reader of [...this.readers]) if (reader.topics.some(topic => topic.kind === 'terminalList' && TERMINAL_LIST_EVENT_TYPES.has(event.type)
      || topic.kind === 'terminal' && (topic.terminalId === '*' || 'terminalId' in event && topic.terminalId === event.terminalId))) reader.handlers.onTerminal?.(event)
  }
  draft(event: Parameters<NonNullable<RpcStreamHandlers['onDraft']>>[0]): void {
    for (const reader of [...this.readers]) if (reader.topics.some(topic => topic.kind === 'drafts')) reader.handlers.onDraft?.(event)
  }
  topic(frame: Parameters<NonNullable<RpcStreamHandlers['onTopic']>>[0]): void {
    for (const reader of [...this.readers]) if (reader.topics.some(topic => topicKey(topic) === topicKey(frame.topic))) reader.handlers.onTopic?.(frame)
  }

  realign(): void { for (const reader of [...this.readers]) {
    if (reader.pending) { reader.pending = []; reader.overflow = true }
    this.recover(reader)
  } }
  close(error = new Error('node stream closed')): void {
    const readers = [...this.readers]
    this.readers.clear()
    for (const reader of readers) { reader.closed = true; reader.handlers.onEnd(error) }
  }

  private recover(reader: Follower): void {
    reader.handlers.onFrame({ sequence: reader.cursor.sequence, epoch: reader.cursor.epoch ?? '', events: [], recover: reader.topics,
      resnapshot: reader.topics.flatMap(topic => topic.kind === 'session' ? [topic.sessionId] : []) })
  }
  private deliver(reader: Follower, frame: SessionStreamFrame): void {
    if (reader.closed) return
    const matches = streamFilterMatcher({ topics: reader.topics })
    const sameEpoch = reader.cursor.epoch === undefined || reader.cursor.epoch === frame.epoch
    if (!sameEpoch) { reader.cursor.versions = {}; reader.cursor.sequence = '0' }
    reader.cursor.epoch = frame.epoch
    const events = frame.events.filter(event => {
      if (!matches(event)) return false
      if (event.aggregateType === 'session' && event.sessionVersion !== undefined) {
        const seen = reader.cursor.versions[event.aggregateId]
        if (seen !== undefined && event.sessionVersion <= seen) return false
        reader.cursor.versions[event.aggregateId] = event.sessionVersion
      } else if (sameEpoch && BigInt(event.sequence) <= BigInt(reader.cursor.sequence)) return false
      return true
    })
    const ids = reader.topics.flatMap(topic => topic.kind === 'session' ? [topic.sessionId] : [])
    const resnapshot = frame.resnapshot?.filter(id => ids.includes(id) || ids.includes('*')) ?? []
    const keys = new Set(reader.topics.map(topicKey))
    const recover = frame.recover?.filter(topic => keys.has(topicKey(topic)))
    if (!sameEpoch) for (const id of ids) if (!resnapshot.includes(id)) resnapshot.push(id)
    if (BigInt(frame.sequence) > BigInt(reader.cursor.sequence)) reader.cursor.sequence = frame.sequence
    if (events.length || resnapshot?.length || recover?.length) reader.handlers.onFrame({ ...frame, events,
      resnapshot: resnapshot?.length ? resnapshot : undefined, recover: recover?.length ? recover : undefined })
  }
}
