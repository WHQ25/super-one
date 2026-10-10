import {
  DATABASE_SCHEMA_GENERATION,
  PROTOCOL_GENERATION,
  negotiateHandshake,
} from '@superone/shared/environment'
import type { AuthenticatedClient } from './auth-service'
import type { ConnectionWire } from './connection-wire'
import type { EventStreamHandle } from './event-stream'
import type { NodeIdentity } from './identity'
import type { RpcContext, RpcResult, RpcStreams } from './rpc-context'
import { ConnectionDelivery } from '../stream/delivery/connection-delivery'
import { deliveryPolicy, type ClientSurface, type ConnectionRoute } from '../stream/delivery-policy'
import type { ControlLeaseService } from '../lease/control-lease'
import type { ControlLease } from '@superone/shared/environment'

/** Per-request fields the transport adds to the host's context. */
export interface NodeRpcRequestContext {
  client: AuthenticatedClient
  requestId?: string
  idempotencyKey?: string
  streams?: RpcStreams
}

export type NodeRpcDispatch<C extends NodeRpcRequestContext = RpcContext> = (
  method: string,
  payload: unknown,
  ctx: C,
) => Promise<RpcResult>

/** One connection's RPC handler; `dispose` closes its push streams with the connection. */
export type ConnectionRpc = ((read: () => unknown) => Promise<void>) & { dispose: () => void }

export interface ConnectionRpcOptions<C extends NodeRpcRequestContext> {
  identity: Pick<NodeIdentity, 'environmentId' | 'aliases'>
  client: AuthenticatedClient
  wire: ConnectionWire
  /** The link this connection came over; picks its delivery tier. */
  route: ConnectionRoute
  surface: ClientSurface
  context: Omit<C, keyof NodeRpcRequestContext>
  dispatch: NodeRpcDispatch<C>
  /** Authority notices are private to this authenticated principal. */
  control?: Pick<ControlLeaseService, 'get' | 'onChange'>
  holdsControl?: (lease: ControlLease) => boolean
  /** Trusted host routing, available only on surfaces authorized to reach other environments. */
  routeRpc?: (environmentId: string, method: string, payload: unknown, ctx: C) => Promise<RpcResult>
  isRevoked: (clientSessionId: string) => boolean
  close: (code: number, reason: string) => void
}

/**
 * The protocol on one authenticated connection, whatever carries it (a node
 * socket, a relay slot, a phone link): generation handshake, envelope checks,
 * dispatch with the connection's push streams and delivery, replies to the
 * asking connection.
 */
export function createConnectionRpc<C extends NodeRpcRequestContext>(opts: ConnectionRpcOptions<C>): ConnectionRpc {
  const { wire, client, identity } = opts
  const send = wire.reply
  const granted = new Map<string, ControlLease>()
  const resourceKey = (resource: ControlLease['resource']) => JSON.stringify([resource.environmentId,
    'sessionId' in resource ? 'session' : 'terminal', 'sessionId' in resource ? resource.sessionId : resource.terminalId])
  const holds = opts.holdsControl ?? ((lease: ControlLease) => lease.holderClientId === client.clientSessionId)
  const stopControl = opts.control?.onChange((resource, lease) => {
    const key = resourceKey(resource)
    const previous = granted.get(key)
    if (lease && holds(lease)) granted.set(key, lease)
    else granted.delete(key)
    if (previous && (!lease || !holds(lease) || lease.leaseId !== previous.leaseId || lease.generation !== previous.generation)) {
      wire.reply({ type: 'client', event: { type: 'control_lost', resource, leaseId: previous.leaseId, generation: previous.generation } })
    }
  })
  let negotiatedGeneration: { protocol: number; databaseSchema: number } | undefined
  const openStreams = new Map<string, EventStreamHandle>()
  const streams: RpcStreams = {
    open(subscriptionId, stream) {
      openStreams.get(subscriptionId)?.close()
      openStreams.set(subscriptionId, stream)
    },
    close(subscriptionId) {
      openStreams.get(subscriptionId)?.close()
      openStreams.delete(subscriptionId)
    },
    get: (subscriptionId) => openStreams.get(subscriptionId),
    push: wire.push,
    flow: wire.flow,
    delivery: new ConnectionDelivery(deliveryPolicy(opts.route, opts.surface)),
  }

  const handle = async (read: () => unknown): Promise<void> => {
    let requestId = 'unknown'
    try {
      if (opts.isRevoked(client.clientSessionId)) {
        opts.close(4001, 'session_revoked')
        return
      }

      const msg = read() as {
        type?: string
        requestId?: string
        method?: string
        payload?: unknown
        environmentId?: string
        protocolVersion?: number
        idempotencyKey?: string
      }
      requestId = msg.requestId || 'unknown'

      if (msg.type === 'ping') {
        send({ type: 'pong', requestId })
        return
      }

      if (msg.type === 'handshake') {
        const remote = (msg.payload || {}) as {
          protocol?: unknown
          databaseSchema?: unknown
        }
        const result = negotiateHandshake(
          {
            protocol: { ...PROTOCOL_GENERATION },
            databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
          },
          {
            protocol: remote.protocol as { current: number; min: number; max: number },
            databaseSchema: remote.databaseSchema as { current: number; min: number; max: number },
          },
        )
        if (!result.ok) {
          send({
            type: 'rpc_error',
            requestId,
            error: { code: 'protocol_incompatible', message: result.reason },
          })
          opts.close(4002, 'protocol_incompatible')
          return
        }
        negotiatedGeneration = { protocol: result.protocol, databaseSchema: result.databaseSchema }
        send({
          type: 'handshake_ok',
          requestId,
          result: {
            protocol: result.protocol,
            databaseSchema: result.databaseSchema,
            environmentId: identity.environmentId,
          },
        })
        wire.startFraming()
        return
      }

      if (msg.type !== 'rpc' && !msg.method) {
        send({
          type: 'rpc_error',
          requestId,
          error: { code: 'invalid_argument', message: 'expected rpc message' },
        })
        return
      }

      const method = msg.method || ''
      const bootstrapRead =
        method === 'environment.descriptor' ||
        method === 'environment.health' ||
        method === 'environment.systemInfo'
      if (!negotiatedGeneration && !bootstrapRead) {
        send({
          type: 'rpc_error',
          requestId,
          error: {
            code: 'failed_precondition',
            message: 'handshake required before non-bootstrap RPC',
          },
        })
        return
      }
      if (negotiatedGeneration && msg.protocolVersion !== negotiatedGeneration.protocol) {
        send({
          type: 'rpc_error',
          requestId,
          error: {
            code: 'protocol_incompatible',
            message:
              msg.protocolVersion === undefined
                ? 'protocolVersion required on RPC envelopes after handshake'
                : `protocolVersion ${msg.protocolVersion} not negotiated`,
          },
        })
        return
      }

      const local = msg.environmentId === identity.environmentId || identity.aliases?.includes(msg.environmentId ?? '')
      if (!msg.environmentId || (!local && !opts.routeRpc)) {
        send({
          type: 'rpc_error',
          requestId,
          error: {
            code: 'environment_mismatch',
            message: msg.environmentId
              ? 'environmentId does not match this node'
              : 'environmentId is required on every RPC envelope',
          },
        })
        return
      }

      const context = {
        ...opts.context,
        client,
        requestId,
        idempotencyKey: msg.idempotencyKey,
        streams,
      } as C
      const result = local
        ? await opts.dispatch(method, msg.payload, context)
        : await opts.routeRpc!(msg.environmentId!, method, msg.payload, context)
      if (local && opts.control && !result.error && result.result
        && (method === 'session.acquireControl' || method === 'terminal.acquireControl')) {
        const lease = result.result as ControlLease
        const current = opts.control.get(lease.resource)
        if (!current || !holds(current) || current.leaseId !== lease.leaseId || current.generation !== lease.generation) {
          send({ type: 'rpc_error', requestId, error: { code: 'lease_stale', message: 'Control changed before admission completed' } })
          return
        }
        granted.set(resourceKey(current.resource), current)
      }
      if (result.error) {
        send({ type: 'rpc_error', requestId, error: result.error })
      } else {
        send({ type: 'rpc_result', requestId, result: result.result })
      }
    } catch (err) {
      const e = err as { message?: string; code?: string }
      send({
        type: 'rpc_error',
        requestId,
        error: { code: e.code || 'internal', message: e.message || 'internal error' },
      })
    }
  }
  return Object.assign(handle, {
    dispose: () => {
      stopControl?.()
      granted.clear()
      for (const stream of openStreams.values()) stream.close()
      openStreams.clear()
    },
  })
}
