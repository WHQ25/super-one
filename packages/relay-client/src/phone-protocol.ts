import { deflateSync, inflateSync } from 'fflate'
import { DATABASE_SCHEMA_GENERATION, PROTOCOL_GENERATION } from '@superone/shared/environment/protocol'
import { RpcConnection, type RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { encodePlainMessage, WireDecoder, WireEncoder } from '@superone/shared/environment/wire'
import { isNodeMutatingCall } from '@superone/shared/environment/rpc-mutating-methods'
import type { TopicRef } from '@superone/shared/environment/topics'
import type { TopicSubscribeInput } from '@superone/shared/environment/events'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import type { LinkHostInfo } from './phone-link'
import { PhoneControlLeases } from './control-leases'
import type { SessionRef, TerminalRef } from '@superone/shared/environment/refs'
import { DesktopUpgradeRequiredError, requirePhoneDesktop } from './phone-version'
export { DesktopUpgradeRequiredError, MIN_PHONE_DESKTOP_VERSION } from './phone-version'

const READS = new Set([
  'environment.descriptor', 'environment.health', 'environment.systemInfo', 'environment.status',
  'environment.usage', 'environment.list', 'project.list', 'harness.systemInfo', 'harness.projectResources',
  'session.list', 'sessionList.page', 'sessionList.pinned', 'sessionList.search', 'sessionList.find',
  'git.status', 'git.branches', 'git.info', 'draft.list',
])

const compression = {
  deflate: (bytes: Uint8Array, dictionary?: Uint8Array) => deflateSync(bytes, { dictionary }),
  inflate: (bytes: Uint8Array, out: Uint8Array, dictionary?: Uint8Array) => inflateSync(bytes, { out, dictionary }),
}

export interface PhoneRpcOptions {
  environmentId?: string
  idempotencyKey?: string
  timeoutMs?: number
}

export interface PhoneTopicStream {
  close(): Promise<void>
  update(topics: TopicRef[]): Promise<void>
}

/** One paired channel's protocol state; compression histories and receipts never survive its replacement. */
export class PhoneProtocol {
  readonly control: PhoneControlLeases
  private readonly encoder = new WireEncoder(compression)
  private readonly decoder = new WireDecoder(compression)
  private readonly connection: RpcConnection
  private framing = false
  private ready: Promise<void> | null = null
  private ended: Error | null = null
  private nextRequest = 0

  constructor(
    readonly host: LinkHostInfo,
    private readonly write: (frame: Uint8Array) => void,
    private readonly onMessage: (message: unknown) => void,
    private readonly newId: () => string = () => crypto.randomUUID(),
    onControlLost: (resource: SessionRef | TerminalRef, error: Error) => void = () => {},
  ) {
    this.connection = new RpcConnection((message) => {
      if (this.ended) throw this.ended
      const frames = this.framing ? this.encoder.encode(message) : [encodePlainMessage(message)]
      for (const frame of frames) this.write(frame)
    }, {
      protocolVersion: PROTOCOL_GENERATION.current,
      // Receipts live only on this connection. Durable mutation keys and stream
      // identities still use globally unique ids across channel replacements.
      newId: () => `r${++this.nextRequest}`,
      responseError: (error) => Object.assign(new Error(error.message), { code: error.code, details: error.details }),
      timeoutError: (method) => new Error(`rpc timeout: ${method}`),
      coalesces: (method) => READS.has(method),
    })
    this.control = new PhoneControlLeases((method, payload, options) => this.rpc(method, payload, options), onControlLost)
  }

  start(): Promise<void> {
    if (this.ready) return this.ready
    try { requirePhoneDesktop(this.host) }
    catch (error) { return Promise.reject(error) }
    this.ready = this.connection.handshake({
      protocol: { ...PROTOCOL_GENERATION }, databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
    }).catch((error: unknown) => {
      if ((error as { code?: string })?.code === 'protocol_incompatible') throw new DesktopUpgradeRequiredError(this.host)
      throw error
    }).then((result) => {
      if (result.environmentId !== this.host.environmentId) throw Object.assign(new Error('desktop identity changed during handshake'), { code: 'identity_conflict' })
      if (result.protocol !== PROTOCOL_GENERATION.current || result.databaseSchema !== DATABASE_SCHEMA_GENERATION.current) throw new DesktopUpgradeRequiredError(this.host)
      if (this.ended) throw this.ended
      this.framing = true
    })
    // A channel can close without a caller waiting for a request.
    void this.ready.catch(() => {})
    return this.ready
  }

  async rpc<T = unknown>(method: string, payload: unknown = {}, options: PhoneRpcOptions = {}): Promise<T> {
    await this.start()
    return this.connection.request<T>(method, payload, {
      environmentId: options.environmentId ?? this.host.environmentId,
      idempotencyKey: options.idempotencyKey ?? (isNodeMutatingCall(method, payload) ? this.newId() : undefined),
      timeoutMs: options.timeoutMs ?? 15_000,
    })
  }

  receive(frame: Uint8Array): void {
    const message = this.decoder.decode(frame)
    if (message !== undefined && !this.connection.receive(message)) {
      const push = message as { type?: string; event?: unknown }
      const event = push?.event as { type?: string; resource?: SessionRef | TerminalRef; leaseId?: string; generation?: string } | undefined
      if (push.type === 'client' && event?.type === 'control_lost' && event.resource
        && typeof event.resource.environmentId === 'string' && typeof event.leaseId === 'string' && typeof event.generation === 'string'
        && (('sessionId' in event.resource && typeof event.resource.sessionId === 'string') || ('terminalId' in event.resource && typeof event.resource.terminalId === 'string'))) {
        this.control.invalidate(event.resource, { leaseId: event.leaseId, generation: event.generation })
      }
      this.onMessage(push?.type === 'client' ? push.event : message)
    }
  }

  async subscribe(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<PhoneTopicStream> {
    await this.start()
    const subscriptionId = this.newId()
    this.connection.openStream(subscriptionId, handlers)
    try {
      await this.rpc('topic.subscribe', { ...input, subscriptionId }, { environmentId: input.topics[0]?.environmentId })
    } catch (error) {
      this.connection.closeStream(subscriptionId)
      throw error
    }
    return {
      close: async () => {
        if (this.connection.closeStream(subscriptionId)) await this.rpc('topic.unsubscribe', { subscriptionId }, { environmentId: input.topics[0]?.environmentId })
      },
      update: async (topics) => {
        if (this.connection.hasStream(subscriptionId)) await this.rpc('topic.update', { subscriptionId, topics }, { environmentId: input.topics[0]?.environmentId })
      },
    }
  }

  async subscribeDetail(input: { sessionId: string; detailRef: string; subscriptionId: string }, listener: (update: DetailUpdate) => void, options: PhoneRpcOptions = {}): Promise<DetailUpdate> {
    await this.start()
    this.connection.watchDetail(input.subscriptionId, listener)
    try { return await this.rpc('session.subscribeDetail', input, options) }
    catch (error) { this.connection.unwatchDetail(input.subscriptionId); throw error }
  }

  async unsubscribeDetail(input: { sessionId: string; subscriptionId: string }, options: PhoneRpcOptions = {}): Promise<void> {
    if (this.connection.unwatchDetail(input.subscriptionId)) await this.rpc('session.unsubscribeDetail', input, options)
  }

  close(error: Error): void {
    if (this.ended) return
    this.ended = error
    this.control.close()
    this.connection.close(error)
  }
}
