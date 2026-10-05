import type { RelayClient } from '@superone/relay-client'
import type { ComposerOpenResult, ComposerOutcomeResult, ComposerSettledEvent, RemoteCommand } from '@superone/shared/agent-types'
import type { SuperOneComposerOutcome } from '@superone/shared/composer-api'
import type { ComposerViewRequest } from '@superone/shared/composer-view-bridge'
import type { InputRequestSpec } from '@superone/shared/input-request'
import { randomId } from './ids'

type Owner = { projectPath: string; sessionId: string }
type Release = Extract<RemoteCommand, { type: 'composer_cancel' }>
export type WidgetComposerResult = { viewId: string; localId: string; outcome?: SuperOneComposerOutcome; error?: string }
type Pending = ComposerViewRequest & Owner & { requestId?: string; early?: ComposerSettledEvent }

// A disposed runtime cannot retry its own releases. Keep them with the connection,
// so restoring that connection also releases forms from the previous transcript.
const releases = new WeakMap<RelayClient, Map<string, Release>>()
const connectionReady = new WeakMap<RelayClient, boolean>()
/** An open relay socket may still have no desktop peer. */
export function setComposerConnection(client: RelayClient, ready: boolean): void {
  connectionReady.set(client, ready)
  if (ready) flushComposerReleases(client)
}
function release(client: RelayClient, command: Release): void {
  let queue = releases.get(client)
  if (!queue) { queue = new Map(); releases.set(client, queue) }
  queue.set(JSON.stringify([command.projectPath, command.sessionId, command.viewId, command.localId]), command)
  flushComposerReleases(client)
}
export function flushComposerReleases(client: RelayClient): void {
  if (!client.connected || connectionReady.get(client) === false) return
  const queue = releases.get(client)
  if (!queue) return
  for (const [key, command] of queue) {
    try { client.send(command); queue.delete(key) } catch { return }
  }
}

/** Short opening receipt, private completion push, and one recovery read per reconnect. */
export class WidgetComposerClient {
  private readonly pending = new Map<string, Pending>()
  private recovery: Promise<void> | null = null
  private disposed = false

  constructor(private readonly client: RelayClient, private readonly owner: () => Owner,
    private readonly deliver: (result: WidgetComposerResult) => void) {}

  async open(request: ComposerViewRequest & { messageId: string }): Promise<ComposerOpenResult> {
    const owner = this.owner()
    if (this.disposed || !owner.projectPath || !owner.sessionId) throw new Error('No active session')
    if (connectionReady.get(this.client) === false) throw new Error('The desktop is offline')
    const key = this.key(request.viewId, request.localId)
    if (this.pending.has(key)) throw new Error('This input request is already open')
    if (this.pending.size >= 128) throw new Error('Too many pending input requests')
    const entry: Pending = { ...request, ...owner }
    this.pending.set(key, entry)
    try {
      const result = await this.client.request({ type: 'composer_open', requestId: randomId(), ...owner,
        messageId: request.messageId, viewId: request.viewId, localId: request.localId,
        spec: request.spec as InputRequestSpec, output: request.output,
      }) as ComposerOpenResult
      if (result?.ok !== true || typeof result.requestId !== 'string' || !result.requestId) {
        this.pending.delete(key)
        if (result?.ok === false) return result
        throw new Error('Could not open this input form')
      }
      entry.requestId = result.requestId
      if (this.pending.get(key) !== entry) {
        // Disposal can overtake the opening receipt. Release once more after
        // admission, when the host is guaranteed to have registered the holder.
        release(this.client, { type: 'composer_cancel', ...owner, viewId: request.viewId })
      } else if (entry.early?.requestId === result.requestId) this.settle(key, entry, entry.early.outcome)
      return result
    } catch (error) {
      this.pending.delete(key)
      // An acknowledgement lost in transit does not prove admission failed.
      release(this.client, { type: 'composer_cancel', ...owner, viewId: request.viewId, localId: request.localId })
      throw error
    }
  }

  consume(value: unknown): boolean {
    if (!value || typeof value !== 'object' || (value as { type?: string }).type !== 'composer_settled') return false
    const event = value as ComposerSettledEvent
    const key = this.key(event.viewId, event.localId), entry = this.pending.get(key)
    if (!entry || event.sessionId !== entry.sessionId || !event.requestId) return true
    if (!entry.requestId) entry.early = event
    else if (event.requestId === entry.requestId) this.settle(key, entry, event.outcome)
    return true
  }

  recover(): Promise<void> {
    if (this.recovery) return this.recovery
    const recover = Promise.all([...this.pending].map(async ([key, entry]) => {
      if (!entry.requestId) return
      try {
        const result = await this.client.request({ type: 'composer_outcome', requestId: randomId(),
          projectPath: entry.projectPath, sessionId: entry.sessionId, inputRequestId: entry.requestId,
        }) as ComposerOutcomeResult
        if (this.pending.get(key) !== entry) return
        if (result.state === 'settled') this.settle(key, entry, result.outcome)
        else if (result.state === 'unknown') {
          this.pending.delete(key)
          this.deliver({ viewId: entry.viewId, localId: entry.localId, error: 'This input form is no longer available' })
        }
      } catch { /* Another disconnect: keep the form until the next reconnect. */ }
    })).then(() => {})
    this.recovery = recover
    void recover.finally(() => { if (this.recovery === recover) this.recovery = null })
    return recover
  }

  release(viewId: string): void {
    const owners = new Map<string, Owner>()
    for (const [key, entry] of this.pending) {
      if (entry.viewId !== viewId) continue
      this.pending.delete(key)
      owners.set(JSON.stringify([entry.projectPath, entry.sessionId]), entry)
      this.deliver({ viewId, localId: entry.localId, outcome: { status: 'cancelled', reason: 'owner_disposed' } })
    }
    for (const owner of owners.values()) release(this.client, {
      type: 'composer_cancel', projectPath: owner.projectPath, sessionId: owner.sessionId, viewId,
    })
  }

  dispose(): void {
    this.disposed = true
    this.releaseAll()
  }

  releaseAll(): void {
    for (const viewId of new Set([...this.pending.values()].map(entry => entry.viewId))) this.release(viewId)
  }

  private key(viewId: string, localId: string): string { return JSON.stringify([viewId, localId]) }
  private settle(key: string, entry: Pending, outcome: SuperOneComposerOutcome): void {
    if (!outcome || (outcome.status !== 'submitted' && outcome.status !== 'cancelled')) return
    this.pending.delete(key)
    this.deliver({ viewId: entry.viewId, localId: entry.localId,
      outcome: entry.output === 'agent' && outcome.status === 'submitted' ? { status: 'submitted' } : outcome,
    })
  }
}
