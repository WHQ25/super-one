import { basename } from 'node:path'
import type { TerminalEvent, TerminalListItem, TerminalSnapshot } from '@superone/shared/agent-types'
import type { ControlLease, MutatingControlContext, TerminalGateway, TerminalRef, TopicSubscribeInput } from '@superone/shared/environment'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import {
  NODE_WINDOW_TERMINAL_OWNER,
  parseRemoteProjectKey,
  parseRemoteTerminalKey,
  remoteProjectKey,
  remoteTerminalKey,
} from '@superone/shared/remote-resource-key'
import { PhoneTerminalFeed } from '@superone/relay-client/terminal-feed'
import type { RemoteTopicStream } from './remote-topic-followers'

/** A connected node's terminals: its terminal RPCs and its pushed topics. */
export interface RemoteTerminalNode {
  /** The node's own environment id, which its terminal refs and topics carry. */
  environmentId: string
  terminals: TerminalGateway
  rpc<T>(method: string, payload: unknown): Promise<T>
  follow(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<RemoteTopicStream>
}

export interface RemoteTerminalControllerOptions {
  /** The connected node behind a connection; throws while it is not connected. */
  node(connectionId: string): RemoteTerminalNode | Promise<RemoteTerminalNode>
  /** Where a session of the node runs, for a terminal opened from it. */
  sessionCwd?(connectionId: string, sessionId: string): Promise<string | null>
  onEvent: (event: TerminalEvent) => void
  /** This desktop started or stopped following a node's terminals. */
  onWatch?: (connectionId: string, watched: boolean) => void
  renewMs?: number
}

const LEASE_TTL_MS = 60_000
/** A held lease is renewed once less than this is left, so the renew timer never lets it lapse. */
const RENEW_MARGIN_MS = 30_000

interface Watch {
  node: RemoteTerminalNode
  /** The node's terminals as it lists them, by its own terminal id. */
  items: Map<string, TerminalListItem>
  stream: RemoteTopicStream | null
}

interface Tab {
  key: string
  connectionId: string
  terminalId: string
  /** The terminal's writer as the node reports it (`ownerDeviceId`). */
  owner: string | null
  lease: { proof: MutatingControlContext; expiresAt: number } | null
  /** This desktop held it until the node's window took it back: only a takeover writes again. */
  yielded: boolean
  feed: PhoneTerminalFeed | null
  /** The terminal is shown here, so its output is followed again after a reconnect. */
  followed: boolean
  renew: ReturnType<typeof setInterval> | null
  leaseTask: Promise<unknown>
  /** The size this desktop shows it at, sent once it writes. */
  size: { cols: number; rows: number } | null
  snapshot: TerminalSnapshot | null
}

function leaseLost(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return code === 'lease_stale' || code === 'lease_required' || code === 'not_found'
}

/**
 * The terminals of paired nodes as this desktop's own tabs. A node's terminal
 * list and the output of the terminals shown here are pushed on the node's
 * shared topic stream, the same contract its phones use; terminal ids here
 * are keys (`remote-terminal:<connectionId>:<id>`), paths project keys.
 *
 * Control follows the node's leases: a terminal its window holds (or nobody
 * does) is written to here, taking it over; one a phone or another desktop
 * holds is read-only. Once the node's window takes it back, this desktop
 * writes again only after an explicit takeover (`claim`).
 */
export class RemoteTerminalController {
  private readonly watches = new Map<string, Promise<Watch>>()
  /** Connections whose terminals were followed, to follow again when they come back. */
  private readonly wanted = new Set<string>()
  private readonly tabs = new Map<string, Tab>()
  private disposed = false

  constructor(private readonly options: RemoteTerminalControllerOptions) {}

  has(terminalId: string): boolean {
    return parseRemoteTerminalKey(terminalId) !== null
  }

  async create(input: { projectPath: string; sessionId?: string; title?: string; cols?: number; rows?: number }): Promise<TerminalListItem> {
    const remote = parseRemoteProjectKey(input.projectPath)
    if (!remote) throw new Error('remote project path required')
    const watch = await this.watch(remote.connectionId)
    // A terminal still opens at the project root if session hydration lags.
    const sessionCwd = input.sessionId
      ? await this.options.sessionCwd?.(remote.connectionId, input.sessionId).catch(() => null)
      : null
    const cwd = sessionCwd || remote.path
    const title = input.title ?? (basename(cwd) || 'Terminal')
    const { terminalId } = await watch.node.terminals.create({ cwd, title, cols: input.cols, rows: input.rows })
    const item = watch.items.get(terminalId)
      ?? { terminalId, cwd, projectPath: remote.path, title, status: 'running', ownerDeviceId: null }
    watch.items.set(terminalId, item)
    // Opened here, so written here.
    const tab = this.tab(remote.connectionId, terminalId)
    await this.hold(tab, watch.node, true).catch(() => null)
    return this.localItem(remote.connectionId, item)
  }

  /** The followed nodes' terminals; a remote project key follows its node's first and lists only those. */
  async list(projectPath?: string): Promise<TerminalListItem[]> {
    const connectionId = projectPath ? parseRemoteProjectKey(projectPath)?.connectionId : undefined
    if (connectionId) {
      const watch = await this.watch(connectionId)
      return [...watch.items.values()].map((item) => this.localItem(connectionId, item))
    }
    const settled = await Promise.all([...this.watches].map(([id, pending]) => pending.then(
      (watch) => [...watch.items.values()].map((item) => this.localItem(id, item)),
      () => [],
    )))
    return settled.flat()
  }

  async snapshot(terminalId: string): Promise<TerminalSnapshot | null> {
    const ref = parseRemoteTerminalKey(terminalId)
    if (!ref) return null
    const tab = this.tab(ref.connectionId, ref.terminalId)
    tab.followed = true
    await this.follow(tab).catch(() => {})
    return tab.snapshot
  }

  async write(terminalId: string, data: string): Promise<void> {
    const tab = this.tabs.get(terminalId)
    if (!tab || !this.view(tab, tab.owner).writableByMe) return
    const watch = await this.watch(tab.connectionId)
    const proof = await this.hold(tab, watch.node, true)
    if (!proof) return
    await watch.node.terminals.write({ terminal: this.ref(watch, tab), data, ...proof })
      .catch((err) => this.failed(tab, err))
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const tab = this.tabs.get(terminalId)
    if (!tab) return
    tab.size = { cols, rows }
    // Only the writer sizes the PTY; a reader would resize it under its writer.
    if (!tab.lease) return
    const watch = await this.watch(tab.connectionId)
    const proof = await this.hold(tab, watch.node, false)
    if (!proof) return
    await watch.node.terminals.resize({ terminal: this.ref(watch, tab), cols, rows, ...proof })
      .catch((err) => this.failed(tab, err))
  }

  /** Take over a terminal the node's window took back (its window yields; phones and desktops do not). */
  async claim(terminalId: string): Promise<void> {
    const tab = this.tabs.get(terminalId)
    if (!tab) return
    const watch = await this.watch(tab.connectionId)
    await this.hold(tab, watch.node, true, true)
  }

  async kill(terminalId: string): Promise<void> {
    const ref = parseRemoteTerminalKey(terminalId)
    if (!ref) return
    const tab = this.tab(ref.connectionId, ref.terminalId)
    const watch = await this.watch(ref.connectionId)
    const proof = await this.hold(tab, watch.node, true, true)
    if (!proof) throw Object.assign(new Error('terminal is held elsewhere'), { code: 'failed_precondition' })
    await watch.node.terminals.kill(this.ref(watch, tab), proof)
    this.drop(tab)
  }

  /** A node is connected again: follow its terminals as before. */
  resume(connectionId: string): void {
    if (this.disposed || !this.wanted.has(connectionId)) return
    void this.watch(connectionId).then(() => {
      for (const tab of this.tabs.values()) {
        if (tab.connectionId === connectionId && tab.followed && !tab.feed) void this.follow(tab).catch(() => {})
      }
    }, () => {})
  }

  dispose(): void {
    this.disposed = true
    for (const tab of [...this.tabs.values()]) {
      const lease = tab.lease
      this.drop(tab)
      if (lease) void this.releaseLease(tab, lease.proof)
    }
    const watches = [...this.watches]
    this.watches.clear()
    for (const [connectionId, pending] of watches) {
      void pending.then((watch) => {
        watch.stream?.close()
        this.options.onWatch?.(connectionId, false)
      }, () => {})
    }
  }

  private tab(connectionId: string, terminalId: string): Tab {
    const key = remoteTerminalKey(connectionId, terminalId)
    let tab = this.tabs.get(key)
    if (!tab) {
      tab = {
        key, connectionId, terminalId,
        owner: null, lease: null, yielded: false, feed: null, followed: false,
        renew: null, leaseTask: Promise.resolve(), size: null, snapshot: null,
      }
      this.tabs.set(key, tab)
    }
    return tab
  }

  private ref(watch: Watch, tab: Tab): TerminalRef {
    return { environmentId: watch.node.environmentId, terminalId: tab.terminalId }
  }

  private watch(connectionId: string): Promise<Watch> {
    if (this.disposed) return Promise.reject(new Error('remote terminals disposed'))
    let pending = this.watches.get(connectionId)
    if (pending) return pending
    pending = this.openWatch(connectionId)
    this.watches.set(connectionId, pending)
    this.wanted.add(connectionId)
    const opened = pending
    opened.catch(() => {
      if (this.watches.get(connectionId) !== opened) return
      this.watches.delete(connectionId)
      this.options.onWatch?.(connectionId, false)
    })
    return pending
  }

  /** Subscribe to the node's terminal list, then list it: no change falls between. */
  private async openWatch(connectionId: string): Promise<Watch> {
    this.options.onWatch?.(connectionId, true)
    const node = await this.options.node(connectionId)
    const watch: Watch = { node, items: new Map(), stream: null }
    const relist = async () => {
      const { terminals } = await node.rpc<{ terminals: TerminalListItem[] }>('terminal.list', {})
      watch.items = new Map(terminals.map((item) => [item.terminalId, item]))
      for (const item of terminals) {
        const tab = this.tabs.get(remoteTerminalKey(connectionId, item.terminalId))
        if (tab && !tab.feed) this.applyOwner(tab, watch, item.ownerDeviceId)
      }
    }
    watch.stream = await node.follow({ afterSequence: '0', topics: [{ kind: 'terminalList', environmentId: node.environmentId }] }, {
      onFrame: (frame) => {
        if (frame.recover?.some((topic) => topic.kind === 'terminalList')) void relist().catch(() => {})
      },
      onTerminal: (event) => {
        if (!('terminalId' in event) || !event.terminalId) return
        const tab = this.tabs.get(remoteTerminalKey(connectionId, event.terminalId))
        // A followed terminal's own stream carries its list events too.
        if (!tab?.feed) this.receive(connectionId, watch, event)
      },
      onEnd: () => {
        void this.watches.get(connectionId)?.then((current) => {
          if (current !== watch) return
          this.watches.delete(connectionId)
          this.options.onWatch?.(connectionId, false)
        }, () => {})
      },
    })
    try {
      await relist()
    } catch (err) {
      watch.stream.close()
      throw err
    }
    return watch
  }

  /** Subscribe to the terminal's output, then attach: output above the attach cut follows the screen. */
  private async follow(tab: Tab): Promise<void> {
    const watch = await this.watch(tab.connectionId)
    if (tab.feed) return tab.feed.refresh()
    const node = watch.node
    const feed = new PhoneTerminalFeed(this.ref(watch, tab), {
      subscribe: async (input, handlers) => {
        const stream = await node.follow(input, handlers)
        return { close: async () => stream.close(), update: (topics) => stream.update(topics) }
      },
      attach: () => node.rpc('terminal.attach', { terminalId: tab.terminalId }),
    }, (event) => { if (tab.feed === feed) this.receive(tab.connectionId, watch, event) }, (err) => {
      if (tab.feed !== feed) return
      tab.feed = null
      if ((err as { code?: string }).code === 'not_found') this.receive(tab.connectionId, watch, { type: 'terminal_exited', terminalId: tab.terminalId, exitCode: null, signal: null })
    })
    tab.feed = feed
    await feed.ready
  }

  private receive(connectionId: string, watch: Watch, event: TerminalEvent): void {
    const remoteId = 'terminalId' in event ? event.terminalId : undefined
    if (!remoteId) return
    const item = watch.items.get(remoteId)
    if (event.type === 'terminal_created') watch.items.set(event.terminalId, event.item)
    else if (event.type === 'terminal_title_changed' && item) item.title = event.title
    else if (event.type === 'terminal_control_changed' && item) item.agentControl = event.control
    else if (event.type === 'terminal_exited') watch.items.delete(remoteId)
    const tab = this.tabs.get(remoteTerminalKey(connectionId, remoteId))
    if (tab) {
      if (event.type === 'terminal_snapshot') this.applyOwner(tab, watch, event.snapshot.ownerDeviceId)
      else if (event.type === 'terminal_snapshot_chunk' && event.snapshot) this.applyOwner(tab, watch, event.snapshot.ownerDeviceId)
      else if (event.type === 'terminal_owner_changed') {
        this.applyOwner(tab, watch, event.ownerDeviceId)
        // The node tells each reader whether it writes: anyone else now holds the lease.
        if (tab.lease && !event.writableByMe) this.lose(tab, false)
      }
    }
    const local = this.toLocal(connectionId, remoteId, event)
    if (tab && local.type === 'terminal_snapshot') tab.snapshot = local.snapshot
    if (event.type === 'terminal_exited' && tab) this.drop(tab)
    this.options.onEvent(local)
  }

  /** The node's writer as last reported; a lost lease shows through its owner change or a refused write. */
  private applyOwner(tab: Tab, watch: Watch, owner: string | null): void {
    tab.owner = owner
    const item = watch.items.get(tab.terminalId)
    if (item) item.ownerDeviceId = owner
  }

  /** The terminal as this desktop shows it: written here unless another client holds it. */
  private view(tab: Tab | undefined, owner: string | null): { ownerDeviceId: string | null; writableByMe: boolean } {
    if (tab?.lease) return { ownerDeviceId: null, writableByMe: true }
    if (owner === null) return tab?.yielded ? { ownerDeviceId: NODE_WINDOW_TERMINAL_OWNER, writableByMe: false } : { ownerDeviceId: null, writableByMe: true }
    return { ownerDeviceId: owner, writableByMe: false }
  }

  private localItem(connectionId: string, item: TerminalListItem): TerminalListItem {
    return {
      ...item,
      terminalId: remoteTerminalKey(connectionId, item.terminalId),
      cwd: remoteProjectKey(connectionId, item.cwd),
      projectPath: remoteProjectKey(connectionId, item.projectPath ?? item.cwd),
      ownerDeviceId: this.view(this.tabs.get(remoteTerminalKey(connectionId, item.terminalId)), item.ownerDeviceId).ownerDeviceId,
    }
  }

  private toLocal(connectionId: string, remoteId: string, event: TerminalEvent): TerminalEvent {
    const terminalId = remoteTerminalKey(connectionId, remoteId)
    const tab = this.tabs.get(terminalId)
    const snapshot = (value: TerminalSnapshot): TerminalSnapshot => ({ ...value, terminalId, ...this.view(tab, value.ownerDeviceId) })
    switch (event.type) {
      case 'terminal_snapshot': return { ...event, terminalId, snapshot: snapshot(event.snapshot) }
      case 'terminal_snapshot_chunk': return { ...event, terminalId, ...(event.snapshot ? { snapshot: snapshot(event.snapshot) } : {}) }
      case 'terminal_owner_changed': return { ...event, terminalId, ...this.view(tab, event.ownerDeviceId) }
      case 'terminal_created': return { ...event, terminalId, item: this.localItem(connectionId, event.item) }
      default: return { ...event, terminalId }
    }
  }

  private emitOwner(tab: Tab): void {
    this.options.onEvent({ type: 'terminal_owner_changed', terminalId: tab.key, ...this.view(tab, tab.owner) })
  }

  /**
   * The lease this desktop writes under, renewed when it runs low. Without
   * `acquire` it is only kept; with it a terminal nobody else holds is taken
   * over, which `takeOver` allows even after the node's window took it back.
   */
  private hold(tab: Tab, node: RemoteTerminalNode, acquire: boolean, takeOver = false): Promise<MutatingControlContext | null> {
    const run = async (): Promise<MutatingControlContext | null> => {
      if (tab.lease && tab.lease.expiresAt > Date.now() + RENEW_MARGIN_MS) return tab.lease.proof
      if (tab.lease) {
        try {
          this.keep(tab, await node.terminals.renewControl({ ...tab.lease.proof, ttlMs: LEASE_TTL_MS }))
          return tab.lease!.proof
        } catch (err) {
          if (!leaseLost(err)) throw err
          this.lose(tab, true)
          return null
        }
      }
      if (!acquire || (tab.yielded && !takeOver)) return null
      const lease = await node.terminals.acquireControl({ resource: { environmentId: node.environmentId, terminalId: tab.terminalId }, ttlMs: LEASE_TTL_MS })
      if (this.disposed || !this.tabs.has(tab.key)) {
        void node.terminals.releaseControl({ leaseId: lease.leaseId, generation: lease.generation }).catch(() => {})
        return null
      }
      tab.yielded = false
      this.keep(tab, lease)
      tab.renew ??= setInterval(() => { void this.hold(tab, node, false).catch(() => {}) }, this.options.renewMs ?? 20_000)
      tab.renew.unref?.()
      this.emitOwner(tab)
      if (tab.size) void node.terminals.resize({ terminal: { environmentId: node.environmentId, terminalId: tab.terminalId }, ...tab.size, ...tab.lease!.proof }).catch(() => {})
      return tab.lease!.proof
    }
    const result = tab.leaseTask.then(run, run)
    tab.leaseTask = result.catch(() => {})
    return result
  }

  private keep(tab: Tab, lease: ControlLease): void {
    tab.lease = { proof: { leaseId: lease.leaseId, generation: lease.generation }, expiresAt: Date.parse(lease.expiresAt) }
  }

  private lose(tab: Tab, announce: boolean): void {
    tab.lease = null
    tab.yielded = true
    if (tab.renew) clearInterval(tab.renew)
    tab.renew = null
    if (announce) this.emitOwner(tab)
  }

  private failed(tab: Tab, err: unknown): void {
    if (!leaseLost(err)) throw err
    if (tab.lease) this.lose(tab, true)
  }

  private async releaseLease(tab: Tab, proof: MutatingControlContext): Promise<void> {
    const node = await Promise.resolve(this.options.node(tab.connectionId)).catch(() => null)
    await node?.terminals.releaseControl(proof).catch(() => {})
  }

  private drop(tab: Tab): void {
    if (this.tabs.get(tab.key) !== tab) return
    this.tabs.delete(tab.key)
    if (tab.renew) clearInterval(tab.renew)
    tab.renew = null
    tab.lease = null
    const feed = tab.feed
    tab.feed = null
    void feed?.close().catch(() => {})
  }
}
