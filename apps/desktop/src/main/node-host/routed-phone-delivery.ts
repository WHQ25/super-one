import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, defaultChatCorePorts, type ChatCoreSession } from '@superone/chat-core'
import { detailMessageId, type ConnectionDelivery } from '@superone/runtime/stream'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import { deliverLoad } from '@superone/runtime/server/session-delivery'

interface View { state: ChatCoreSession; summarized: boolean; version: number; epoch: string; mapper: ReturnType<typeof createNodeSessionEventMapper>; ports: typeof defaultChatCorePorts }

/** A routed reader reduces only full upstream data; summarized upstream bodies remain on their source node. */
export class RoutedPhoneDelivery {
  private readonly views = new Map<string, View>()
  load(environmentId: string, loaded: SessionLoadResult, delivery: ConnectionDelivery, includeState = true): SessionLoadResult {
    const id = JSON.stringify([environmentId, loaded.sessionId])
    const previous = this.views.get(id)
    if (previous && previous.epoch !== loaded.cursor.epoch) delivery.views.close(loaded.sessionId)
    if (!previous || previous.epoch !== loaded.cursor.epoch || loaded.cursor.version >= previous.version) {
      const messages = [...new Map([...(previous?.epoch === loaded.cursor.epoch ? previous.state.messages : []), ...loaded.messages,
        ...(loaded.activeTurn ?? [])].map(message => [message.id, message])).values()].slice(-400)
      const retained = !includeState && previous?.epoch === loaded.cursor.epoch ? previous : undefined
      const state = { ...createDefaultChatCoreSession(), ...retained?.state, ...loaded.state, messages } as ChatCoreSession
      this.views.set(id, { state,
        version: loaded.cursor.version, epoch: loaded.cursor.epoch, summarized: loaded.summarized === true,
        mapper: retained?.mapper ?? createNodeSessionEventMapper({ sessionId: loaded.sessionId, projectPath: '', providerId: String(state.sessionProvider ?? loaded.state.providerId ?? loaded.state.harnessId ?? '') }),
        ports: retained?.ports ?? { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() } })
    }
    return deliverLoad(loaded, delivery)
  }
  has(environmentId: string, sessionId: string): boolean { return this.views.has(JSON.stringify([environmentId, sessionId])) }
  summarized(environmentId: string, sessionId: string): boolean { return this.views.get(JSON.stringify([environmentId, sessionId]))?.summarized === true }
  detail(environmentId: string, input: { sessionId: string; detailRef: string; subscriptionId: string }, delivery: ConnectionDelivery): DetailUpdate {
    const message = this.views.get(JSON.stringify([environmentId, input.sessionId]))?.state.messages.find(row => row.id === detailMessageId(input.detailRef))
    if (!message) throw Object.assign(new Error('Detail not found in loaded rows'), { code: 'not_found' })
    return delivery.views.subscribe(input.sessionId, input.subscriptionId, input.detailRef, message)
  }

  frame(environmentId: string, frame: SessionStreamFrame, delivery: ConnectionDelivery, pushDetail: (sessionId: string, update: DetailUpdate) => void): SessionStreamFrame {
    return { ...frame, events: frame.events.flatMap(envelope => {
      if (envelope.aggregateType !== 'session') return [envelope]
      const view = this.views.get(JSON.stringify([environmentId, envelope.aggregateId]))
      if (!view) return (envelope.payload as { event?: unknown } | null)?.event ? [] : [envelope]
      if (view.epoch !== frame.epoch) return []
      const version = envelope.sessionVersion ?? Number(envelope.sequence)
      const events = view.mapper.map(envelope)
      if (!view.summarized && version > view.version) {
        for (const event of events) view.state = { ...view.state, ...applyEventToSession(view.state, event, view.ports) }
      }
      view.version = Math.max(view.version, version)
      const shaped = events.flatMap((event): AgentEvent[] => view.summarized ? delivery.shape(event) : delivery.event(event, envelope.aggregateId, view.state.messages))
      if (!view.summarized) for (const event of delivery.details(envelope.aggregateId, view.state.messages)) {
        if (event.type === 'remote_detail') pushDetail(envelope.aggregateId, { subscriptionId: event.subscriptionId, revision: event.revision, offset: event.offset, text: event.text })
      }
      return shaped.map(event => ({ ...envelope, eventType: 'session.agent_event', payload: { event } }))
    }) }
  }
  clear(): void { this.views.clear() }
}
