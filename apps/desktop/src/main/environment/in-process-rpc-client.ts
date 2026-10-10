import { randomUUID } from 'node:crypto'
import { ADMIN_PAIRING_SCOPES, PROTOCOL_GENERATION, type ExecutionEnvironmentDescriptor, type TopicSubscribeInput, type RpcCommandEnvelope } from '@superone/shared/environment'
import { RpcConnection, type RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import { bindControlActor } from '@superone/runtime/lease'
import { isNodeMutatingCall } from '@superone/runtime/server/rpc-mutating-methods'
import type { RpcStreams } from '@superone/runtime/server/rpc-context'
import { ConnectionDelivery, deliveryPolicy } from '@superone/runtime/stream'
import type { DesktopDomain } from '../node-host/desktop-domain'
import { currentControlScope } from '../session/control-context'
import { EnvironmentRpcClient, type TopicStream } from './environment-rpc-client'

/** The local gateway speaks the same RPC contract directly to its desktop domain. */
export class InProcessRpcClient extends EnvironmentRpcClient {
  readonly tier = 'lan' as const
  private readonly connection: RpcConnection
  private readonly streams: RpcStreams

  constructor(private readonly domain: DesktopDomain) {
    super()
    const open = new Map<string, ReturnType<RpcStreams['get']>>()
    this.connection = new RpcConnection((message) => {
      const request = message as RpcCommandEnvelope
      const clientSessionId = currentControlScope()?.clientSessionId ?? 'ipc:0'
      const actor = clientSessionId.startsWith('phone:') || clientSessionId.startsWith('ipc:')
        ? bindControlActor(domain.leases, {
          clientSessionId, holderClientId: `desktop:${domain.identity.environmentId}`,
          delegate: clientSessionId.replace(/^ipc:/, 'window:'), yields: clientSessionId.startsWith('ipc:'),
        }) : domain.leases
      void domain.dispatchRpc(request.method, request.payload, {
        ...domain.phoneContext(), leases: actor, streams: this.streams,
        requestId: request.requestId, idempotencyKey: request.idempotencyKey,
        client: { clientSessionId, scopes: [...ADMIN_PAIRING_SCOPES], devicePublicKeyPem: '', devicePublicKeyFingerprint: '' },
      }).then((result) => this.connection.receive(result.error
        ? { type: 'rpc_error', requestId: request.requestId, error: result.error }
        : { type: 'rpc_result', requestId: request.requestId, result: result.result }),
      (error: unknown) => this.connection.receive({ type: 'rpc_error', requestId: request.requestId, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }))
    }, {
      newId: randomUUID, protocolVersion: PROTOCOL_GENERATION.current,
      responseError: (error) => Object.assign(new Error(error.message), error),
      timeoutError: (method) => new Error(`local RPC timed out: ${method}`),
    })
    this.streams = {
      open: (id, stream) => { open.get(id)?.close(); open.set(id, stream) },
      close: (id) => { open.get(id)?.close(); open.delete(id) },
      get: (id) => open.get(id),
      push: (message) => { this.connection.receive(message) },
      delivery: new ConnectionDelivery(deliveryPolicy('ipc', 'desktop')),
    }
    domain.onClose(() => {
      for (const stream of open.values()) stream?.close()
      open.clear()
      this.connection.close(Object.assign(new Error('desktop domain closed'), { code: 'unavailable' }))
    })
  }

  rpc<T = unknown>(method: string, payload: unknown = {}, environmentId = this.domain.identity.environmentId, commandKey?: string): Promise<T> {
    if (environmentId !== this.domain.identity.environmentId && !this.domain.identity.aliases?.includes(environmentId)) {
      return Promise.reject(Object.assign(new Error('environment identity mismatch'), { code: 'identity_conflict' }))
    }
    return this.connection.request<T>(method, payload, { environmentId,
      ...(isNodeMutatingCall(method, payload) ? { idempotencyKey: commandKey ?? randomUUID() } : {}) })
  }

  getDescriptor(): Promise<ExecutionEnvironmentDescriptor> { return this.rpc('environment.descriptor') }

  async subscribeEvents(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<TopicStream> {
    const subscriptionId = randomUUID()
    this.connection.openStream(subscriptionId, handlers)
    try { await this.rpc('topic.subscribe', { ...input, subscriptionId }) }
    catch (error) { this.connection.closeStream(subscriptionId); throw error }
    return {
      close: () => { if (this.connection.closeStream(subscriptionId)) void this.rpc('topic.unsubscribe', { subscriptionId }).catch(() => {}) },
      update: async (topics) => { await this.rpc('topic.update', { subscriptionId, topics }) },
    }
  }

  async subscribeDetail(input: { sessionId: string; detailRef: string; subscriptionId: string }, onUpdate: (update: DetailUpdate) => void): Promise<DetailUpdate> {
    this.connection.watchDetail(input.subscriptionId, onUpdate)
    try { return await this.rpc('session.subscribeDetail', input) }
    catch (error) { this.connection.unwatchDetail(input.subscriptionId); throw error }
  }

  async unsubscribeDetail(input: { sessionId: string; subscriptionId: string }): Promise<void> {
    if (this.connection.unwatchDetail(input.subscriptionId)) await this.rpc('session.unsubscribeDetail', input)
  }
}
