import { randomUUID } from 'node:crypto'
import { ADMIN_PAIRING_SCOPES, DATABASE_SCHEMA_GENERATION, PROTOCOL_GENERATION, type ExecutionEnvironmentDescriptor, type TopicSubscribeInput } from '@superone/shared/environment'
import { RpcConnection, type RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import { createConnectionRpc, createFramedWire } from '@superone/runtime/server'
import { WireDecoder } from '@superone/shared/environment/wire'
import { nodeWireCompression } from '@superone/runtime/server/wire-compression'
import { EnvironmentRpcClient, type TopicStream } from '../environment/environment-rpc-client'
import { RemoteEnvironmentGateway } from '../environment/remote-environment-gateway'
import { RemoteSessionFeed } from '../environment/remote-session-feed'
import type { DesktopDomain } from './desktop-domain'

/** A real native node connection/dispatcher over an in-memory wire, sharing one feed with desktop readers. */
export async function routedNode(cleanup: Array<() => void>, domain: DesktopDomain, tier: 'lan' | 'relay') {
  const decoder = new WireDecoder(nodeWireCompression)
  let connection!: RpcConnection
  const controlListeners = new Set<(event: import('@superone/shared/environment').ControlLostEvent) => void>()
  const wire = createFramedWire({ write: frame => {
    const message = decoder.decode(frame)
    if (message !== undefined) connection.receive(message)
  }, buffered: () => 0 })
  const rpc = createConnectionRpc({ identity: domain.identity, wire, route: tier, surface: 'desktop',
    client: { clientSessionId: 'root-controller', scopes: [...ADMIN_PAIRING_SCOPES], devicePublicKeyFingerprint: 'root', devicePublicKeyPem: '' },
    context: domain.phoneContext(), dispatch: domain.dispatchRpc, control: domain.leases, isRevoked: () => false, close: () => {} })
  connection = new RpcConnection(message => { void rpc(() => message) }, {
    protocolVersion: PROTOCOL_GENERATION.current, newId: randomUUID,
    responseError: err => Object.assign(new Error(err.message), err), timeoutError: () => new Error('fixture timeout'),
    onControlLost: event => { for (const listener of controlListeners) listener(event) },
  })
  await connection.handshake({ protocol: { ...PROTOCOL_GENERATION }, databaseSchema: { ...DATABASE_SCHEMA_GENERATION } })
  let opened = 0
  class Client extends EnvironmentRpcClient {
    onControlLost(listener: (event: import('@superone/shared/environment').ControlLostEvent) => void) {
      controlListeners.add(listener)
      return () => { controlListeners.delete(listener) }
    }
    readonly tier = tier
    rpc<T>(method: string, payload: unknown = {}, environmentId = domain.identity.environmentId, commandKey?: string) {
      return connection.request<T>(method, payload, { environmentId, idempotencyKey: commandKey ?? randomUUID(), timeoutMs: 1000 })
    }
    getDescriptor() { return this.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor') }
    async subscribeEvents(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<TopicStream> {
      opened++
      const subscriptionId = randomUUID()
      connection.openStream(subscriptionId, handlers)
      await this.rpc('topic.subscribe', { ...input, subscriptionId })
      return { close: () => { if (connection.closeStream(subscriptionId)) void this.rpc('topic.unsubscribe', { subscriptionId }) },
        update: async topics => { await this.rpc('topic.update', { subscriptionId, topics }) } }
    }
    async subscribeDetail(input: { sessionId: string; detailRef: string; subscriptionId: string }, onUpdate: (update: DetailUpdate) => void) {
      connection.watchDetail(input.subscriptionId, onUpdate)
      return this.rpc<DetailUpdate>('session.subscribeDetail', input)
    }
    async unsubscribeDetail(input: { sessionId: string; subscriptionId: string }) {
      connection.unwatchDetail(input.subscriptionId); await this.rpc('session.unsubscribeDetail', input)
    }
  }
  const client = new Client()
  const gateway = new RemoteEnvironmentGateway(client)
  const feed = new RemoteSessionFeed({ head: () => gateway.eventHeadSequence(),
    subscribe: (afterSequence, signal, handlers) => gateway.subscribeEvents({ environmentId: domain.identity.environmentId,
      afterSequence, signal, topics: handlers.interest.current(), ...handlers }) }, domain.identity.environmentId)
  cleanup.push(() => { feed.close(); rpc.dispose(); connection.close(new Error('fixture closed')); wire.close() })
  return { client, feed, opened: () => opened, environmentId: domain.identity.environmentId,
    follow: (input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers) => feed.followTopics(input, handlers, () => client.rpc('topic.catchUp', input)) }
}
