import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment/refs'
import type { SessionLoadCursor } from '@superone/shared/environment/session-messages'
import type { TopicSubscribeInput } from '@superone/shared/environment/events'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import type { PhoneTopicStream } from './phone-protocol'

/** The visible transcript follows one scoped session at the atomic load cursor. */
export class PhoneSessionFeed {
  private current: { ref: SessionRef; stream?: PhoneTopicStream; release?: () => Promise<void> } | null = null
  constructor(
    private readonly subscribe: (input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers) => Promise<PhoneTopicStream>,
    private readonly deliver: (events: AgentEvent[]) => void,
    private readonly recover: (session: SessionRef, error?: Error) => void,
    private readonly retain?: (session: SessionRef) => () => Promise<void>,
  ) {}

  async follow(input: { session: SessionRef; projectPath: string; provider?: string; cursor: SessionLoadCursor }): Promise<void> {
    const previous = this.current
    const current = { ref: input.session } as NonNullable<typeof this.current>
    this.current = current
    current.release = this.retain?.(input.session)
    let version = input.cursor.version
    let recovering = false
    const mapper = createNodeSessionEventMapper({ sessionId: input.session.sessionId, projectPath: input.projectPath, providerId: input.provider })
    try {
      await this.retire(previous)
      if (this.current !== current) return
      const stream = await this.subscribe({
        afterSequence: input.cursor.sequence, epoch: input.cursor.epoch,
        versions: { [input.session.sessionId]: version }, topics: [{ kind: 'session', ...input.session }],
      }, {
        onFrame: frame => {
          if (this.current !== current || recovering) return
          if (frame.epoch !== input.cursor.epoch || frame.resnapshot?.includes(input.session.sessionId)
            || frame.recover?.some(topic => topic.kind === 'session' && topic.environmentId === input.session.environmentId && topic.sessionId === input.session.sessionId)) {
            recovering = true
            this.recover(input.session)
            return
          }
          const events: AgentEvent[] = []
          for (const envelope of frame.events) {
            if (envelope.environmentId !== input.session.environmentId || envelope.aggregateType !== 'session' || envelope.aggregateId !== input.session.sessionId) continue
            const next = envelope.sessionVersion ?? Number(envelope.sequence)
            if (next <= version) continue
            version = next
            events.push(...mapper.map(envelope).map(event => ({ ...event, environmentId: input.session.environmentId })))
          }
          if (events.length) this.deliver(events)
        },
        onEnd: error => { if (this.current === current) this.recover(input.session, error) },
      })
      if (this.current !== current) await stream.close()
      else current.stream = stream
    } catch (error) {
      if (this.current === current) await this.stop().catch(() => {})
      throw error
    }
  }

  async stop(): Promise<void> {
    const current = this.current
    this.current = null
    await this.retire(current)
  }

  private async retire(current: typeof this.current): Promise<void> {
    // Release synchronously before waiting for unsubscribe; never borrow a later grant.
    const release = current?.release?.()
    await Promise.all([current?.stream?.close(), release])
  }

  reset(): void { this.current = null }
}
