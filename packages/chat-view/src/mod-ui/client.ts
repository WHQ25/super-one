import type { AgentEvent } from '@superone/shared/agent-types'
import {
  EMPTY_MOD_PANE_ROSTER,
  type ModClientModuleBundle,
  type ModHostReply,
  type ModHostRequest,
  type ModHostRequestKind,
  type ModKeyedRow,
  type ModOnScreen,
  type ModPaneRoster,
  type ModRenderComponent,
  type ModRenderResult,
  type ModScrollComponent,
  type ModSurface,
  type ModUiOp,
  type ModUiRequest,
  type ModUiResult,
  type ModViewport,
} from '@superone/shared/mod-ui'

/** How a view reaches its session's mod surface (desktop IPC, phone relay). */
export type ModUiTransport = <O extends ModUiOp>(op: O, request: ModUiRequest<O>) => Promise<ModUiResult<O>>

/** Per-ask extras a Pane / band reports from its last layout. */
export interface ModSiteLayout {
  viewport?: ModViewport
  contentRows?: number
  keyed?: ModKeyedRow[]
  onScreen?: ModOnScreen | null
}

export type ModSiteStatus =
  /** Nothing to draw: the session draws no mods, no plugin hooks the site, or the ask failed. */
  | 'off'
  /** First ask in flight. Transcript sites keep their own drawing meanwhile. */
  | 'pending'
  | 'ready'

export interface ModSiteSnapshot {
  status: ModSiteStatus
  result: ModRenderResult | null
  /** The props this ask carried (what `engine ref 0` and later refs draw with). */
  props: Record<string, unknown>
}

export interface ModUiClientOptions {
  transport: ModUiTransport
  surface: ModSurface
  clientId: string
  /** CLI → client requests this client answers (clipboard, composer). */
  answers?: ModHostRequestKind[]
  hostHandler?: (request: ModHostRequest) => Promise<ModHostReply>
  /** The client's whole drawing area in cells, sent with attach. */
  viewport?: () => ModViewport | undefined
  /** Called when the client hits an unexpected failure (logged by the host). */
  onError?: (op: ModUiOp, err: unknown) => void
}

interface Entry {
  component: ModRenderComponent
  instanceId: string
  props: Record<string, unknown>
  propsKey: string
  layout: ModSiteLayout
  snapshot: ModSiteSnapshot
  stale: boolean
  inflight: boolean
  listeners: Set<() => void>
}

type SiteSignal = { type: 'scroll'; offset: number; followEnd?: boolean } | { type: 'focus'; plugin: string; key: string }

export interface ModUiClientState {
  available: boolean
  roster: ModPaneRoster
}

const OFF: ModSiteSnapshot = { status: 'off', result: null, props: {} }

const entryKey = (component: ModRenderComponent, instanceId: string) => `${component}\u0000${instanceId}`

/**
 * One client of one session's mod surface: attaches when the session can draw
 * mods, holds the pane roster, asks the CLI to draw each mounted site and keeps
 * the answers until the CLI says they are stale.
 *
 * Framework-free; the React bindings in `./react` subscribe to it. A site whose
 * component no plugin hooks costs one ask until the next un-narrowed
 * invalidation, so a transcript with no UI mod stays at zero round trips.
 */
export class ModUiClient {
  readonly surface: ModSurface
  readonly clientId: string
  private available = false
  private attached = false
  private roster: ModPaneRoster = EMPTY_MOD_PANE_ROSTER
  private state: ModUiClientState = { available: false, roster: EMPTY_MOD_PANE_ROSTER }
  private readonly unhooked = new Set<ModRenderComponent>()
  /** Components known hooked since the last un-narrowed invalidation. */
  private readonly hooked = new Set<ModRenderComponent>()
  /** Components whose first ask is in flight; their other instances wait for it. */
  private readonly probing = new Set<ModRenderComponent>()
  private readonly entries = new Map<string, Entry>()
  private readonly stateListeners = new Set<() => void>()
  private readonly signalListeners = new Map<string, Set<(signal: SiteSignal) => void>>()
  private flushScheduled = false
  private disposed = false
  /** Bumped by `reset`: an answer to an ask from before it is dropped. */
  private generation = 0
  /** Per plugin, its `Client` modules for the hash a tree named. */
  private readonly bundles = new Map<string, { hash: string; bundle: Promise<ModClientModuleBundle | null> }>()

  constructor(private readonly opts: ModUiClientOptions) {
    this.surface = opts.surface
    this.clientId = opts.clientId
  }

  get isAvailable(): boolean {
    return this.available && this.attached
  }

  get panes(): ModPaneRoster {
    return this.roster
  }

  /** Availability and roster as one immutable value (a `useSyncExternalStore` snapshot). */
  getState(): ModUiClientState {
    return this.state
  }

  /** Re-renders on availability and roster changes. */
  subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /** Feeds one session event; ignores everything that is not a mod event. */
  handleEvent(event: AgentEvent): void {
    if (this.disposed) return
    switch (event.type) {
      case 'mod_ui_state':
        if (event.available) void this.attach()
        else this.reset()
        return
      case 'mod_panes':
        this.roster = event.roster
        this.notifyState()
        return
      case 'mod_invalidate':
        this.invalidate(event.instances?.filter((i) => i.surface === this.surface).map((i) => entryKey(i.component, i.instanceId)))
        return
      case 'mod_scroll':
        if (event.clientId === this.clientId) this.signal(event.component, event.instanceId, { type: 'scroll', offset: event.offset, followEnd: event.followEnd })
        return
      case 'mod_focus':
        if (event.clientId === this.clientId) this.signal(event.component, event.instanceId, { type: 'focus', plugin: event.plugin, key: event.key })
        return
      case 'mod_host_request':
        if (event.clientId === this.clientId) void this.answerHost(event.requestId, event.request)
        return
    }
  }

  /** Attaches (again) — after availability, or when the host learns a session was already live. */
  async attach(): Promise<void> {
    this.available = true
    try {
      await this.opts.transport('attach', {
        surface: this.surface,
        clientId: this.clientId,
        viewport: this.opts.viewport?.(),
        ...(this.opts.answers?.length ? { answers: this.opts.answers } : {}),
      })
      this.attached = true
      this.roster = await this.opts.transport('panes', { clientId: this.clientId })
    } catch (err) {
      this.attached = false
      this.opts.onError?.('attach', err)
    }
    this.forgetHooks()
    this.invalidate()
    this.notifyState()
  }

  /** The session stopped drawing mods (runtime released, preference off). */
  reset(): void {
    this.generation++
    this.available = false
    this.attached = false
    this.roster = EMPTY_MOD_PANE_ROSTER
    this.forgetHooks()
    for (const entry of this.entries.values()) this.setSnapshot(entry, OFF)
    this.notifyState()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.attached) void this.opts.transport('detach', { clientId: this.clientId }).catch(() => {})
    this.entries.clear()
    this.stateListeners.clear()
  }

  /**
   * Keeps one site drawn while `listener` is subscribed. Updating the props or
   * layout re-asks only when they changed.
   */
  observe(component: ModRenderComponent, instanceId: string, props: Record<string, unknown>, layout: ModSiteLayout, listener: () => void): () => void {
    const key = entryKey(component, instanceId)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { component, instanceId, props, propsKey: '', layout, snapshot: OFF, stale: true, inflight: false, listeners: new Set() }
      this.entries.set(key, entry)
    }
    entry.listeners.add(listener)
    this.update(component, instanceId, props, layout)
    return () => {
      const current = this.entries.get(key)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) this.entries.delete(key)
    }
  }

  /** Updates a site's props / layout; re-asks when they changed. */
  update(component: ModRenderComponent, instanceId: string, props: Record<string, unknown>, layout: ModSiteLayout): void {
    const entry = this.entries.get(entryKey(component, instanceId))
    if (!entry) return
    // Nothing to ask (no plugin hooks it, or mods are off): keep the latest
    // props for the next invalidation without paying to serialize them.
    if (!this.isAvailable || this.unhooked.has(component)) {
      entry.props = props
      entry.layout = layout
      entry.propsKey = ''
      return
    }
    const propsKey = stableKey(props)
    const layoutChanged = layoutKey(layout) !== layoutKey(entry.layout)
    entry.layout = layout
    if (propsKey === entry.propsKey && !layoutChanged && !entry.stale) return
    entry.props = props
    entry.propsKey = propsKey
    entry.stale = true
    this.scheduleFlush()
  }

  snapshot(component: ModRenderComponent, instanceId: string): ModSiteSnapshot {
    return this.entries.get(entryKey(component, instanceId))?.snapshot ?? OFF
  }

  /** Scroll and focus moves a plugin made for one site of this client. */
  onSiteSignal(component: ModScrollComponent, instanceId: string, listener: (signal: SiteSignal) => void): () => void {
    const key = entryKey(component, instanceId)
    let set = this.signalListeners.get(key)
    if (!set) this.signalListeners.set(key, (set = new Set()))
    set.add(listener)
    return () => set!.delete(listener)
  }

  /**
   * Runs an op on the surface for this client. Acting on a site re-asks it,
   * since the plugin's closure usually changed what it draws.
   */
  async act<O extends ModUiOp>(op: O, request: ModUiRequest<O>, redraw?: { component: ModRenderComponent; instanceId: string }): Promise<ModUiResult<O> | null> {
    if (!this.isAvailable) return null
    try {
      return await this.opts.transport(op, request)
    } catch (err) {
      this.opts.onError?.(op, err)
      return null
    } finally {
      if (redraw) this.invalidate([entryKey(redraw.component, redraw.instanceId)])
    }
  }

  /** A plugin's `Client` modules, fetched once per hash (a reload changes it). */
  clientBundle(plugin: string, hash: string): Promise<ModClientModuleBundle | null> {
    const held = this.bundles.get(plugin)
    if (held?.hash === hash) return held.bundle
    const bundle = this.act('clientModule', { plugin }).then((b) => {
      // A failed fetch is asked again by the next drawing.
      if (!b && this.bundles.get(plugin)?.bundle === bundle) this.bundles.delete(plugin)
      return b
    })
    this.bundles.set(plugin, { hash, bundle })
    return bundle
  }

  private forgetHooks(): void {
    this.unhooked.clear()
    this.hooked.clear()
    this.probing.clear()
  }

  private invalidate(keys?: string[]): void {
    if (!keys) this.forgetHooks()
    const targets = keys ? keys.map((k) => this.entries.get(k)).filter((e): e is Entry => !!e) : [...this.entries.values()]
    for (const entry of targets) entry.stale = true
    if (targets.length > 0) this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || this.disposed) return
    this.flushScheduled = true
    const run = () => {
      this.flushScheduled = false
      this.flush()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 0)
  }

  private flush(): void {
    for (const entry of this.entries.values()) {
      if (!entry.stale || entry.inflight || entry.listeners.size === 0) continue
      if (!this.isAvailable || this.unhooked.has(entry.component)) {
        entry.stale = false
        this.setSnapshot(entry, { ...OFF, props: entry.props })
        continue
      }
      // One ask tells whether a component is hooked; a transcript's other rows wait for it.
      if (!this.hooked.has(entry.component)) {
        if (this.probing.has(entry.component)) continue
        this.probing.add(entry.component)
      }
      void this.ask(entry)
    }
  }

  private async ask(entry: Entry): Promise<void> {
    entry.stale = false
    entry.inflight = true
    const props = entry.props
    if (!entry.propsKey) entry.propsKey = stableKey(props)
    if (entry.snapshot.status === 'off') this.setSnapshot(entry, { status: 'pending', result: null, props })
    const generation = this.generation
    try {
      const result = await this.opts.transport('render', {
        surface: this.surface,
        clientId: this.clientId,
        component: entry.component,
        instanceId: entry.instanceId,
        props,
        ...entry.layout,
      })
      if (generation !== this.generation) return
      if (this.probing.delete(entry.component)) {
        if (result.hooked) this.hooked.add(entry.component)
        else this.unhooked.add(entry.component)
        this.scheduleFlush()
      } else if (!result.hooked) this.unhooked.add(entry.component)
      this.setSnapshot(entry, result.hooked ? { status: 'ready', result, props } : { ...OFF, props })
    } catch (err) {
      if (generation !== this.generation) return
      if (this.probing.delete(entry.component)) this.scheduleFlush()
      this.opts.onError?.('render', err)
      this.setSnapshot(entry, { ...OFF, props })
    } finally {
      entry.inflight = false
      if (entry.stale) this.scheduleFlush()
    }
  }

  private setSnapshot(entry: Entry, snapshot: ModSiteSnapshot): void {
    entry.snapshot = snapshot
    for (const listener of entry.listeners) listener()
  }

  private signal(component: ModScrollComponent, instanceId: string, signal: SiteSignal): void {
    for (const listener of this.signalListeners.get(entryKey(component, instanceId)) ?? []) listener(signal)
  }

  private async answerHost(requestId: string, request: ModHostRequest): Promise<void> {
    const handler = this.opts.hostHandler
    if (!handler) return
    let reply: ModHostReply
    try {
      reply = await handler(request)
    } catch (err) {
      this.opts.onError?.('hostReply', err)
      return
    }
    await this.opts.transport('hostReply', { requestId, clientId: this.clientId, reply }).catch((err) => this.opts.onError?.('hostReply', err))
  }

  private notifyState(): void {
    this.state = { available: this.isAvailable, roster: this.roster }
    for (const listener of this.stateListeners) listener()
  }
}

function stableKey(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(Math.random())
  }
}

function layoutKey(layout: ModSiteLayout): string {
  // Height alone never changes a drawing; width and docking do (CLI rule).
  // `contentRows` / `keyed` describe the last drawing: they ride the next ask
  // (and every scroll report) without forcing one, or each draw would ask twice.
  return stableKey([layout.viewport?.columns, layout.viewport?.isFullscreen, layout.onScreen])
}
