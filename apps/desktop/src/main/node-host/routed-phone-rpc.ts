import { randomUUID } from 'node:crypto'
import type { ControlLease, RpcError, SessionLoadResult, TopicSubscribeInput } from '@superone/shared/environment'
import { isNodeMutatingCall } from '@superone/shared/environment/rpc-mutating-methods'
import { readTopicRef, type TopicRef } from '@superone/shared/environment/topics'
import { ConnectionDelivery, detailMessageId } from '@superone/runtime/stream'
import type { AuthenticatedClient, RpcContext, RpcResult } from '@superone/runtime/server'
import type { EnvironmentRpcClient } from '../environment/environment-rpc-client'
import type { RemoteTopicStream } from '../environment/remote-topic-followers'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { RoutedPhoneControl, type RoutedGrant } from './routed-phone-control'
import { RoutedPhoneGrants, type RoutedGrantOwner } from './routed-phone-grants'
import { RoutedPhoneDelivery } from './routed-phone-delivery'

type Target = {
  environmentId: string
  client: Pick<EnvironmentRpcClient, 'rpc' | 'subscribeDetail' | 'unsubscribeDetail'> & Partial<Pick<EnvironmentRpcClient, 'onControlLost'>>
  follow(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<RemoteTopicStream>
}
export interface PhoneRpcRoute {
  dispatch(environmentId: string, method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult>
  close(): void
}
export interface PhoneRpcRouter {
  open(client: AuthenticatedClient): PhoneRpcRoute
  releaseSessions(sessionId?: string): Promise<void>
  close(): void
}
const error = (code: string, message: string) => Object.assign(new Error(message), { code })
const record = (payload: unknown): Record<string, unknown> => payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}

/** Phone envelopes reach configured nodes natively; the root authenticates delegates and shares its existing feed. */
export function createPhoneRpcRouter(resolve: (environmentId: string) => Promise<Target> | Target,
  changed?: ConstructorParameters<typeof RoutedPhoneGrants>[1]): PhoneRpcRouter {
  const control = new RoutedPhoneControl()
  const grants = new RoutedPhoneGrants(control, changed)
  const upstream = new Map<string, { client: Target['client']; stop(): void }>()
  const routes = new Set<PhoneRpcRoute>()
  return {
    open(client) {
      const actor = client.clientSessionId
      const owner: RoutedGrantOwner = { active: true }
      const views = new RoutedPhoneDelivery()
      const deliveries = new Map<string, ConnectionDelivery>()
      const subscriptions = new Map<string, { environmentId: string; stream: RemoteTopicStream }>()
      const opening = new Map<string, { environmentId: string; active: boolean }>()
      const details = new Map<string, { environmentId: string; sessionId: string; nativeId?: string; target?: Target }>()
      let closed = false
      const deliveryFor = (environmentId: string, ctx: RpcContext) => {
        if (!ctx.streams?.delivery) throw error('failed_precondition', 'Routed RPC requires a connection')
        let delivery = deliveries.get(environmentId)
        if (!delivery) deliveries.set(environmentId, delivery = new ConnectionDelivery(ctx.streams.delivery.policy))
        return delivery
      }
      const topicsOf = (environmentId: string, value: unknown): TopicRef[] => {
        if (!Array.isArray(value) || value.length > 64) throw error('invalid_argument', 'topics must be a bounded list of topic refs')
        const topics = value.map(readTopicRef)
        if (topics.some(topic => !topic)) throw error('invalid_argument', 'Invalid topic ref')
        for (const topic of topics as TopicRef[]) {
          if (topic.environmentId !== environmentId) throw error('identity_conflict', 'Topic belongs to another environment')
          if (topic.kind === 'session' && !views.has(environmentId, topic.sessionId)) throw error('failed_precondition', 'Load the scoped session before following it')
        }
        return topics as TopicRef[]
      }
      const route: PhoneRpcRoute = {
        async dispatch(environmentId, method, payload, ctx) {
          let captured: RoutedGrant | undefined
          owner.push = ctx.streams?.push
          let intent: { environmentId: string; active: boolean } | undefined
          let detailIntent: { environmentId: string; sessionId: string; nativeId?: string; target?: Target } | undefined
          const p = record(payload)
          const subscriptionId = String(p.subscriptionId ?? '')
          try {
            if (closed) throw error('unavailable', 'Phone connection closed')
            // Cancellation is local and must retire an intent even while its target is resolving.
            if (method === 'topic.update' || method === 'topic.unsubscribe') {
              const current = subscriptions.get(subscriptionId)
              const pending = opening.get(subscriptionId)
              if (current && current.environmentId !== environmentId || pending && pending.environmentId !== environmentId) throw error('identity_conflict', 'Subscription belongs to another environment')
              if (method === 'topic.unsubscribe') {
                if (pending) pending.active = false
                opening.delete(subscriptionId)
                if (current) ctx.streams?.close(subscriptionId)
                return { result: { ok: true } }
              }
              if (!current) throw error('not_found', 'No routed subscription')
              await current.stream.update(topicsOf(environmentId, p.topics))
              return { result: { ok: true } }
            }
            if (method === 'session.unsubscribeDetail') {
              const current = details.get(subscriptionId)
              if (current && (current.environmentId !== environmentId || current.sessionId !== p.sessionId)) throw error('identity_conflict', 'Detail belongs to another session')
              details.delete(subscriptionId)
              if (current?.nativeId && current.target) await current.target.client.unsubscribeDetail({ sessionId: current.sessionId, subscriptionId: current.nativeId })
              else deliveries.get(environmentId)?.views.unsubscribe(String(p.sessionId ?? ''), subscriptionId)
              return { result: { ok: true } }
            }
            if (method === 'topic.subscribe') {
              if (!ctx.streams || !subscriptionId || !/^\d+$/.test(String(p.afterSequence ?? ''))) throw error('invalid_argument', 'Native subscription and cursor required')
              topicsOf(environmentId, p.topics)
              const current = subscriptions.get(subscriptionId)
              const pending = opening.get(subscriptionId)
              if (current && current.environmentId !== environmentId || pending && pending.environmentId !== environmentId) throw error('identity_conflict', 'Subscription belongs to another environment')
              if (pending) pending.active = false
              if (current) ctx.streams.close(subscriptionId)
              intent = { environmentId, active: true }
              opening.set(subscriptionId, intent)
            }
            if (method === 'session.subscribeDetail') {
              const sessionId = String(p.sessionId ?? '')
              if (!sessionId || !subscriptionId || !p.detailRef || !views.has(environmentId, sessionId)) throw error('failed_precondition', 'Load session before expanding detail')
              if (details.has(subscriptionId)) throw error('conflict', 'Detail subscription already open')
              detailIntent = { environmentId, sessionId }
              details.set(subscriptionId, detailIntent)
            }
            const mutating = isNodeMutatingCall(method, p)
            if (mutating && !ctx.idempotencyKey) throw error('invalid_argument', 'idempotencyKey required for mutating RPC')
            if (method.startsWith('client.') || method.startsWith('composer.') || method === 'session.claimHostAction' || method === 'session.respondHostAction') throw Object.assign(error('not_found', 'Method belongs to the paired desktop'), { details: { unsupported: true, method } })
            const kind = method.startsWith('terminal.') ? 'terminal' : 'session'
            const acquire = method === `${kind}.acquireControl`
            const renew = method === `${kind}.renewControl`
            const release = method === `${kind}.releaseControl`
            const fenced = renew || release || mutating && (method.startsWith('session.') && method !== 'session.create'
              || method.startsWith('terminal.') && method !== 'terminal.create' || method === 'mcpApps.request')
            // Capture before resolving a target or waiting for its queue; never substitute a later grant.
            const grant = captured = fenced && !acquire ? control.capture(actor, environmentId, kind, p, renew || release) : undefined
            const target = await resolve(environmentId)
            if (closed) throw error('unavailable', 'Phone connection closed')
            if (intent && (!intent.active || opening.get(subscriptionId) !== intent)) throw error('unavailable', 'Phone subscription cancelled')
            if (detailIntent && details.get(subscriptionId) !== detailIntent) throw error('unavailable', 'Detail subscription cancelled')
            if (target.environmentId !== environmentId) throw error('identity_conflict', 'Route reached another environment')
            if (grant) control.assertCurrent(grant)
            const commandKey = ctx.idempotencyKey ? JSON.stringify([actor, ctx.idempotencyKey]) : undefined
            if (acquire) {
              const previous = upstream.get(environmentId)
              if (previous?.client !== target.client) {
                previous?.stop()
                upstream.set(environmentId, { client: target.client,
                  stop: target.client.onControlLost?.(event => grants.invalidateProof(event)) ?? (() => {}) })
              }
              const id = String(p[kind === 'session' ? 'sessionId' : 'terminalId'] ?? '')
              if (!id) throw error('invalid_argument', 'Resource id required')
              const resource = kind === 'session' ? { environmentId, sessionId: id } : { environmentId, terminalId: id }
              return await grants.run(resource, async () => {
                if (closed) throw error('unavailable', 'Phone connection closed')
                const lease = await target.client.rpc<ControlLease>(method, { ...p, delegate: actor, yields: false }, environmentId, commandKey)
                const held = control.remember(actor, environmentId, kind, id, lease)
                await grants.attach(held, owner, () => target.client.rpc(`${kind}.releaseControl`, {
                  leaseId: held.lease.leaseId, generation: held.lease.generation, delegate: actor,
                }, environmentId, randomUUID()))
                return { result: lease }
              })
            }
            if (renew && grant) {
              return await grants.run(grant.lease.resource, async () => {
                control.assertCurrent(grant)
                const lease = await target.client.rpc<ControlLease>(method, p, environmentId, commandKey)
                control.renewed(grant, lease)
                grants.renewed(grant)
                return { result: lease }
              })
            }
            if (release && grant) {
              return { result: await grants.release(grant) }
            }
            if (method === 'session.load') {
              const loaded = await target.client.rpc<SessionLoadResult>(method, p, environmentId)
              if (closed) throw error('unavailable', 'Phone connection closed')
              return { result: views.load(environmentId, loaded, deliveryFor(environmentId, ctx), p.includeState !== false) }
            }
            if (method === 'topic.subscribe') {
              const streams = ctx.streams!
              const topics = topicsOf(environmentId, p.topics)
              const delivery = deliveryFor(environmentId, ctx)
              const currentIntent = intent!
              const stream = await target.follow({ ...p, topics } as Omit<TopicSubscribeInput, 'subscriptionId'>, {
                onFrame: frame => { if (currentIntent.active && !closed) streams.push({ type: 'stream', subscriptionId,
                  frame: views.frame(environmentId, frame, delivery, (sessionId, update) => streams.push({ type: 'detail', sessionId, update })) }) },
                onTerminal: event => {
                  if (!currentIntent.active || closed) return
                  streams.push({ type: 'terminal', subscriptionId, event: event.type === 'terminal_owner_changed'
                    ? { ...event, writableByMe: control.owns(actor, environmentId, 'terminal', event.terminalId) } : event })
                },
                onDraft: event => { if (currentIntent.active && !closed) streams.push({ type: 'draft', subscriptionId, event }) },
                onTopic: frame => { if (currentIntent.active && !closed) streams.push({ type: 'topic', subscriptionId, frame }) },
                onEnd: () => { if (currentIntent.active && !closed) streams.push({ type: 'stream', subscriptionId, frame: {
                  sequence: String(p.afterSequence), epoch: String(p.epoch ?? ''), events: [], recover: topics,
                  resnapshot: topics.flatMap(topic => topic.kind === 'session' ? [topic.sessionId] : []),
                } }) },
              })
              if (closed || !currentIntent.active || opening.get(subscriptionId) !== currentIntent) { stream.close(); throw error('unavailable', 'Phone subscription cancelled') }
              opening.delete(subscriptionId)
              const wrapped: RemoteTopicStream = { update: next => stream.update(next), close: () => {
                currentIntent.active = false; stream.close()
                if (subscriptions.get(subscriptionId)?.stream === wrapped) subscriptions.delete(subscriptionId)
              } }
              streams.open(subscriptionId, { close: wrapped.close, setTopics: next => { void wrapped.update([...next]).catch(() => {}) } })
              subscriptions.set(subscriptionId, { environmentId, stream: wrapped })
              return { result: { subscriptionId } }
            }
            if (method === 'session.subscribeDetail') {
              const sessionId = String(p.sessionId ?? '')
              const detailRef = String(p.detailRef ?? '')
              const current = detailIntent!
              current.target = target
              current.nativeId = views.summarized(environmentId, sessionId) ? randomUUID() : undefined
              try {
                if (current.nativeId) {
                  const update = await target.client.subscribeDetail({ sessionId, detailRef, subscriptionId: current.nativeId }, update => {
                    if (!closed && details.get(subscriptionId) === current) ctx.streams?.push({ type: 'detail', sessionId, update: { ...update, subscriptionId } })
                  })
                  if (closed || details.get(subscriptionId) !== current) {
                    await target.client.unsubscribeDetail({ sessionId, subscriptionId: current.nativeId }).catch(() => {})
                    throw error('unavailable', 'Detail subscription cancelled')
                  }
                  return { result: { ...update, subscriptionId } }
                }
                const delivery = deliveryFor(environmentId, ctx)
                try { return { result: views.detail(environmentId, { sessionId, detailRef, subscriptionId }, delivery) } }
                catch (err) {
                  if ((err as { code?: string }).code !== 'not_found') throw err
                  const loaded = await target.client.rpc<SessionLoadResult>('session.load', { sessionId, anchorId: detailMessageId(detailRef), limit: 1, includeState: false }, environmentId)
                  if (closed || details.get(subscriptionId) !== current) throw error('unavailable', 'Detail subscription cancelled')
                  views.load(environmentId, loaded, delivery, false)
                  return { result: views.detail(environmentId, { sessionId, detailRef, subscriptionId }, delivery) }
                }
              } catch (err) { if (details.get(subscriptionId) === current) details.delete(subscriptionId); throw err }
            }
            const result = await target.client.rpc(method, p, environmentId, commandKey)
            if (method === 'terminal.attach' && result && typeof result === 'object' && 'terminal' in result) {
              return { result: { ...result, terminal: { ...(result.terminal as object), writableByMe: control.owns(actor, environmentId, 'terminal', String(p.terminalId ?? '')) } } }
            }
            return { result }
          } catch (err) {
            if (intent) {
              intent.active = false
              if (opening.get(subscriptionId) === intent) opening.delete(subscriptionId)
            }
            if (detailIntent && details.get(subscriptionId) === detailIntent) details.delete(subscriptionId)
            const e = err as { code?: RpcError['code']; message?: string; details?: unknown }
            if (captured && e.code === 'lease_stale') grants.invalidate(captured)
            return { error: { code: e.code ?? 'internal', message: e.message ?? 'Routed RPC failed', ...(e.details !== undefined ? { details: e.details as Record<string, unknown> } : {}) } }
          }
        },
        close() {
          if (closed) return
          closed = true
          grants.detach(owner)
          for (const subscription of subscriptions.values()) subscription.stream.close()
          subscriptions.clear()
          for (const pending of opening.values()) pending.active = false
          opening.clear()
          for (const detail of details.values()) if (detail.nativeId && detail.target) void detail.target.client.unsubscribeDetail({ sessionId: detail.sessionId, subscriptionId: detail.nativeId }).catch(() => {})
          details.clear(); views.clear(); deliveries.clear(); routes.delete(route)
        },
      }
      routes.add(route)
      return route
    },
    releaseSessions: sessionId => grants.releaseSessions(sessionId),
    close() {
      for (const route of [...routes]) route.close()
      for (const watch of upstream.values()) watch.stop()
      upstream.clear()
    },
  }
}
