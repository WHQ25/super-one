import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, defaultChatCorePorts, type ChatCoreSession } from '@superone/chat-core'
import { detailMessageId, windowLiveEvent, type ConnectionDelivery } from '@superone/runtime/stream'
import type { TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import { deliverLoad } from '@superone/runtime/server/session-delivery'

interface View {
  state: ChatCoreSession; summarized: boolean; version: number; epoch: string
  mapper: ReturnType<typeof createNodeSessionEventMapper>; ports: typeof defaultChatCorePorts
  /** The phone holds a transcript window the source keeps current under this holder id. */
  windowHolder?: string
}

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
      state.realtimeThreadMessages = loaded.restore?.realtimeThreadMessages ?? retained?.state.realtimeThreadMessages ?? []
      this.views.set(id, { state,
        version: loaded.cursor.version, epoch: loaded.cursor.epoch, summarized: loaded.summarized === true,
        // A read beside the window (a partial message's copy) keeps the phone following its window.
        ...(retained?.windowHolder !== undefined ? { windowHolder: retained.windowHolder } : {}),
        mapper: retained?.mapper ?? createNodeSessionEventMapper({ sessionId: loaded.sessionId, projectPath: '', providerId: String(state.sessionProvider ?? loaded.state.providerId ?? loaded.state.harnessId ?? '') }),
        ports: retained?.ports ?? { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() } })
    }
    return deliverLoad(loaded, delivery)
  }
  /**
   * A transcript window the source served for this phone (`holder`). The
   * source keeps it current with `transcript_window` patches tagged with the
   * holder, which `frame` relays in place of the content events.
   */
  window(environmentId: string, loaded: TranscriptWindowResult, delivery: ConnectionDelivery, holder: string): TranscriptWindowResult {
    const id = JSON.stringify([environmentId, loaded.sessionId])
    const previous = this.views.get(id)
    const sameEpoch = previous?.epoch === loaded.cursor.epoch
    if (previous && !sameEpoch) delivery.views.close(loaded.sessionId)
    const state = { ...createDefaultChatCoreSession(), ...(sameEpoch && !loaded.state ? previous.state : {}), ...loaded.state, messages: sameEpoch ? previous.state.messages : [] } as ChatCoreSession
    state.realtimeThreadMessages = loaded.restore?.realtimeThreadMessages ?? (sameEpoch ? previous.state.realtimeThreadMessages : [])
    this.views.set(id, {
      state, version: Math.max(loaded.cursor.version, sameEpoch ? previous.version : 0), epoch: loaded.cursor.epoch,
      summarized: loaded.summarized === true, windowHolder: holder,
      mapper: (sameEpoch ? previous.mapper : undefined) ?? createNodeSessionEventMapper({ sessionId: loaded.sessionId, projectPath: '', providerId: String(state.sessionProvider ?? '') }),
      ports: (sameEpoch ? previous.ports : undefined) ?? { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() },
    })
    const shaped = deliverLoad({ sessionId: loaded.sessionId, state: loaded.state ?? {}, messages: [], before: null, cursor: loaded.cursor, ...(loaded.restore ? { restore: loaded.restore } : {}) }, delivery)
    return { ...loaded, ...(loaded.state ? { state: shaped.state } : {}), ...(shaped.restore ? { restore: shaped.restore } : {}), summarized: true }
  }
  has(environmentId: string, sessionId: string): boolean { return this.views.has(JSON.stringify([environmentId, sessionId])) }
  summarized(environmentId: string, sessionId: string): boolean { return this.views.get(JSON.stringify([environmentId, sessionId]))?.summarized === true }
  detail(environmentId: string, input: { sessionId: string; detailRef: string; subscriptionId: string }, delivery: ConnectionDelivery): DetailUpdate {
    const view = this.views.get(JSON.stringify([environmentId, input.sessionId]))
    const message = view && [...view.state.messages, ...view.state.realtimeThreadMessages].find(row => row.id === detailMessageId(input.detailRef))
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
      const detailRows = [...view.state.messages, ...view.state.realtimeThreadMessages]
      const shaped = events.flatMap((event): AgentEvent[] => {
        if (event.type === 'transcript_window') {
          // Patches for other phones this desktop relays for stay with them.
          if (event.holder !== view.windowHolder) return []
          const { holder: _holder, ...own } = event
          return [own]
        }
        const next = view.summarized ? delivery.shape(event) : delivery.event(event, envelope.aggregateId, detailRows)
        return view.windowHolder === undefined ? next : next.flatMap(item => windowLiveEvent(item) ?? [])
      })
      if (!view.summarized) for (const event of delivery.details(envelope.aggregateId, detailRows)) {
        if (event.type === 'remote_detail') pushDetail(envelope.aggregateId, { subscriptionId: event.subscriptionId, revision: event.revision, offset: event.offset, text: event.text })
      }
      return shaped.map(event => ({ ...envelope, eventType: 'session.agent_event', payload: { event } }))
    }) }
  }
  clear(): void { this.views.clear() }
}
