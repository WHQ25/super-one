import type { AgentEvent, TerminalEvent } from '@superone/shared/agent-types'
import type { TopicNoticeFrame, TopicSubscribeInput } from '@superone/shared/environment/events'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { topicKey, type TopicRef, type TopicVersionCursor } from '@superone/shared/environment/topics'
import type { PhoneTopicStream } from './phone-protocol'

const KINDS = ['sessionList', 'projects', 'drafts', 'environment', 'terminalList'] as const
type Subscribe = (input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers) => Promise<PhoneTopicStream>
type Hooks = {
  onSnapshot(topic: TopicRef, snapshot: unknown): void
  onEvents(events: AgentEvent[]): void
  onTerminal(event: TerminalEvent): void
  onRecover(topic: TopicRef, error?: Error): void
}

/** Workspace cursors are scoped to their topic and never advance a transcript's cursor. */
export class PhoneWorkspaceFeed {
  private current: { environmentId: string; stream?: PhoneTopicStream; recovering: boolean } | null = null
  private generation = 0
  constructor(private readonly subscribe: Subscribe, private readonly hooks: Hooks) {}

  async follow(environmentId: string, topicCursors: Record<string, TopicVersionCursor> = {}): Promise<void> {
    const generation = ++this.generation
    await this.retire()
    if (this.generation !== generation) return
    const current = this.current = { environmentId, recovering: false } as NonNullable<typeof this.current>
    const cursors = new Map(Object.entries(topicCursors))
    const recover = (topic: TopicRef, error?: Error) => {
      if (this.current !== current || current.recovering) return
      current.recovering = true
      this.hooks.onRecover(topic, error)
    }
    const receive = (frame: TopicNoticeFrame) => {
      if (this.current !== current || current.recovering || frame.topic.environmentId !== environmentId || !KINDS.some(kind => kind === frame.topic.kind)) return
      const key = topicKey(frame.topic)
      const previous = cursors.get(key)
      const snapshot = Object.prototype.hasOwnProperty.call(frame, 'snapshot')
      const cursor = frame.cursor
      if (cursor) {
        if (!cursor.epoch || !Number.isSafeInteger(cursor.version) || cursor.version < 0) { recover(frame.topic); return }
        if (previous && cursor.epoch === previous.epoch && cursor.version <= previous.version && !snapshot) return
        const contiguous = frame.afterVersion === undefined
          ? cursor.version === (previous?.version ?? 0) + frame.events.length
          : frame.topic.kind === 'drafts' && Number.isSafeInteger(frame.afterVersion) && frame.afterVersion >= 0
            && frame.afterVersion === previous?.version && cursor.version > frame.afterVersion
            && cursor.version - frame.afterVersion >= frame.events.length
            && frame.events.every(event => event.type === 'draft_changed' && event.reason === 'saved')
        if (!snapshot && (!previous || previous.epoch !== cursor.epoch || !contiguous)) { recover(frame.topic); return }
        if (snapshot && previous?.epoch === cursor.epoch && cursor.version < previous.version) return
        cursors.set(key, cursor)
      } else if (frame.topic.kind !== 'environment') { recover(frame.topic); return }
      if (snapshot) this.hooks.onSnapshot(frame.topic, frame.snapshot)
      if (frame.events.length) this.hooks.onEvents(frame.events.map(event => ({ ...event, environmentId })))
    }
    try {
      const stream = await this.subscribe({ afterSequence: '0', topics: KINDS.map(kind => ({ kind, environmentId })), topicCursors }, {
        onFrame: () => {}, // Workspace snapshots and versions have their own recovery log.
        onTopic: receive,
        onDraft: event => {
          if (this.current === current && !current.recovering) this.hooks.onEvents([{ ...event, environmentId }])
        },
        onTerminal: event => {
          if (this.current === current && !current.recovering && ['terminal_created', 'terminal_title_changed', 'terminal_exited', 'terminal_control_changed'].includes(event.type)) this.hooks.onTerminal(event)
        },
        onEnd: error => recover({ kind: 'environment', environmentId }, error),
      })
      if (this.current !== current) await stream.close()
      else current.stream = stream
    } catch (error) {
      if (this.current === current) this.current = null
      throw error
    }
  }

  async stop(): Promise<void> {
    this.generation++
    await this.retire()
  }

  private async retire(): Promise<void> {
    const current = this.current
    this.current = null
    await current?.stream?.close()
  }

  reset(): void { this.generation++; this.current = null }
}
