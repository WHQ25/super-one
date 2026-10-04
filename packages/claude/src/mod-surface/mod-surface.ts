import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  MOD_UI_UNAVAILABLE,
  type ModHostReply,
  type ModHostRequestKind,
  type ModUiOp,
  type ModUiRequest,
  type ModUiResult,
} from '@superone/shared/mod-ui'
import { fromWireResponse, mapModSystemMessage, toHostRequest, toWireHostReply, toWireRequest } from './wire'

/** The capability `initialize` / `system/init` lists when the CLI serves remote surfaces. */
export const UI_SURFACE_CAPABILITY = 'ui_surface_v1'

/**
 * What the adapter needs from an SDK `Query`. `request` and `setUiHost` are
 * runtime methods the SDK does not declare (0.3.287); `initializationResult` is
 * public. Kept structural so tests drive the adapter without a CLI.
 */
export interface ModSurfaceQuery {
  initializationResult?: () => Promise<{ capabilities?: string[] }>
  request?: (inner: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
  setUiHost?: (host: Record<string, (req: Record<string, unknown>, ctx?: { signal?: AbortSignal }) => Promise<unknown>>) => void
}

export interface ModSurfaceOptions {
  query: ModSurfaceQuery
  emit: (event: AgentEvent) => void
  /** The user's "draw mod interfaces" preference. Read when availability is decided. */
  enabled?: () => boolean
  /** Per-request timeout; the SDK's `request()` has none. */
  requestTimeoutMs?: number
  /** How long a client has to answer a CLI → host request (the CLI waits 5 s). */
  hostReplyTimeoutMs?: number
}

class ModUiUnavailableError extends Error {
  override name = MOD_UI_UNAVAILABLE
}

interface PendingHostRequest {
  kind: ModHostRequestKind
  /** The client the CLI routed the request to; only its reply is taken. */
  clientId: string
  resolve: (reply: ModHostReply | null) => void
}

/**
 * One Claude query's mod surface: SuperOne's side of the CLI's remote-surface
 * protocol. Views reach it through `call(op, request)`; CLI pushes come in
 * through `handleSystem` and go out as `mod_*` AgentEvents.
 *
 * Fails closed: until the CLI advertises `ui_surface_v1` (and the user has not
 * turned mod drawing off), every op rejects with `mod-ui-unavailable` and views
 * draw SuperOne's own components.
 */
export class ModSurface {
  private available = false
  /** The CLI serves remote surfaces; `available` also needs the user's preference. */
  private capable = false
  private decided = false
  private disposed = false
  private readonly clientAnswers = new Map<string, Set<ModHostRequestKind>>()
  private readonly pendingHost = new Map<string, PendingHostRequest>()
  private readonly requestTimeoutMs: number
  private readonly hostReplyTimeoutMs: number

  constructor(private readonly opts: ModSurfaceOptions) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000
    this.hostReplyTimeoutMs = opts.hostReplyTimeoutMs ?? 4_500
    const { query } = opts
    if (typeof query.request !== 'function' || typeof query.setUiHost !== 'function') return
    query.setUiHost({
      copy: (req) => this.relayHostRequest('copy', req),
      promptRead: (req) => this.relayHostRequest('promptRead', req),
      promptFill: (req) => this.relayHostRequest('promptFill', req),
      promptSuggest: (req) => this.relayHostRequest('promptSuggest', req),
    })
    void query.initializationResult?.().then(
      (init) => this.setAvailable(Array.isArray(init?.capabilities) && init.capabilities.includes(UI_SURFACE_CAPABILITY)),
      () => this.setAvailable(false),
    )
  }

  get isAvailable(): boolean {
    return this.available
  }

  /** Re-reads the user preference (after it changed) and re-announces availability. */
  refreshEnabled(): void {
    if (this.capable) this.setAvailable(true)
  }

  private setAvailable(capable: boolean): void {
    if (this.disposed) return
    this.capable = capable
    const next = capable && (this.opts.enabled?.() ?? true)
    // Re-announcing `true` is deliberate: views re-attach on it after a preference change.
    if (this.decided && next === this.available && !next) return
    this.decided = true
    this.available = next
    if (!next) this.clientAnswers.clear()
    this.opts.emit({ type: 'mod_ui_state', available: next })
  }

  async call<O extends ModUiOp>(op: O, request: ModUiRequest<O>): Promise<ModUiResult<O>> {
    if (op === 'hostReply') return this.acceptHostReply(request as ModUiRequest<'hostReply'>) as ModUiResult<O>
    if (!this.available || this.disposed) throw new ModUiUnavailableError('This session cannot draw mod interfaces')
    const wireOp = op as Exclude<ModUiOp, 'hostReply'>
    if (wireOp === 'attach') {
      const { clientId, answers } = request as ModUiRequest<'attach'>
      if (answers) this.clientAnswers.set(clientId, new Set(answers))
    } else if (wireOp === 'detach') {
      this.clientAnswers.delete((request as ModUiRequest<'detach'>).clientId)
    }
    const signal = AbortSignal.timeout(this.requestTimeoutMs)
    const response = await this.opts.query.request!(toWireRequest(wireOp, request as Record<string, unknown>), { signal })
    // `request()` resolves the control_response envelope; its payload is `response`.
    const payload = response && typeof response === 'object' && 'response' in response ? (response as { response: unknown }).response : response
    return fromWireResponse(wireOp, payload) as ModUiResult<O>
  }

  /** Consumes a mod push; false when `sys` is not one. */
  handleSystem(sys: Record<string, unknown>): boolean {
    const event = mapModSystemMessage(sys)
    if (!event) return false
    if (this.available) this.opts.emit(event)
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.available) this.opts.emit({ type: 'mod_ui_state', available: false })
    this.available = false
    for (const pending of this.pendingHost.values()) pending.resolve(null)
    this.pendingHost.clear()
  }

  /**
   * A plugin asked a client to act (clipboard, composer). The CLI names the
   * client; the request goes out as `mod_host_request` and waits for that
   * client's `hostReply`. Never throws: an error reply would make the CLI wait
   * its full 5 s, so a missing answer resolves the safe default instead.
   */
  private async relayHostRequest(kind: ModHostRequestKind, req: Record<string, unknown>): Promise<Record<string, unknown>> {
    const clientId = typeof req.client_id === 'string' ? req.client_id : ''
    if (!this.available || !this.clientAnswers.get(clientId)?.has(kind)) return toWireHostReply(kind, null)
    const requestId = randomUUID()
    const reply = await new Promise<ModHostReply | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingHost.delete(requestId)
        resolve(null)
      }, this.hostReplyTimeoutMs)
      this.pendingHost.set(requestId, {
        kind,
        clientId,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
      })
      this.opts.emit({ type: 'mod_host_request', clientId, requestId, request: toHostRequest(kind, req) })
    })
    return toWireHostReply(kind, reply)
  }

  /** Whether a `mod_host_request` still waits for its client; a delivered copy of a finished one must not be acted on. */
  isHostRequestPending(requestId: string): boolean {
    return this.pendingHost.has(requestId)
  }

  private acceptHostReply({ requestId, clientId, reply }: ModUiRequest<'hostReply'>): ModUiResult<'hostReply'> {
    const pending = this.pendingHost.get(requestId)
    if (!pending || pending.kind !== reply.kind || pending.clientId !== clientId) return { accepted: false }
    this.pendingHost.delete(requestId)
    pending.resolve(reply)
    return { accepted: true }
  }
}

export function isModUiUnavailable(err: unknown): boolean {
  return err instanceof Error && err.name === MOD_UI_UNAVAILABLE
}
