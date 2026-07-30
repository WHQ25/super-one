import { parseActions } from './actions'
import {
  looksLikeBundleId,
  matchRunningApp,
  targetIdentity,
  uniqueApps,
} from './app-identity'
import { refineActOutcome } from './outcome'
import {
  collectRefs,
  diffOutlines,
  expandSubtree,
  findNode,
  foldOutline,
  searchOutline,
} from './outline'
import { ComputerUsePolicy } from './policy'
import { FakePlatformBackend } from './platform/fake-backend'
import type { PlatformAdapter } from './platform/types'
import type { PlatformLook } from './platform/types'
import { ResourceScheduler } from './resource-scheduler'
import { boundText, clearContinuations } from './result-view'
import { RootRegistry } from './root-registry'
import { StateStore } from './state-store'
import {
  ComputerUseError,
  type ActResult,
  type AppsActionResult,
  type AppsListOptions,
  type AppsListResult,
  type AppsSnapshot,
  type AppCatalogEntry,
  type CaptureScope,
  type Condition,
  type DeliveryMode,
  type ObserveMode,
  type ObserveResult,
  type QueryResult,
  type StateDiff,
  type UiAction,
  type UiRootIdentity,
  type WaitResult,
  type ZoomResult,
} from './types'

type RunningAppMeta = {
  app: string
  bundleId: string
  pid: number
  frontmost: boolean
}

export interface ComputerUseServiceOptions {
  adapter?: PlatformAdapter
  policy?: ComputerUsePolicy
  stateLimit?: number
  /** Skip policy checks (unit tests that focus on state machine only). */
  bypassPolicy?: boolean
  clock?: () => number
}

let stateSeq = 0

function nextStateId(): string {
  stateSeq += 1
  return `S${stateSeq}`
}

/** Reset module-level id counters (tests). */
export function resetComputerUseIds(): void {
  stateSeq = 0
  clearContinuations()
}

/**
 * Owns Computer Use runtime state. Single owner — providers must not hold
 * helper sessions or snapshot stores of their own.
 */
export class ComputerUseService {
  readonly policy: ComputerUsePolicy
  private readonly adapter: PlatformAdapter
  private readonly states: StateStore
  private readonly scheduler = new ResourceScheduler()
  private readonly roots = new RootRegistry()
  private readonly bypassPolicy: boolean
  private readonly clock: () => number
  private readonly fake: FakePlatformBackend | null
  /**
   * Last launch/focus target — used when computer_snapshot omits root so we
   * do not fall back to SuperOne (still frontmost after background launch).
   */
  private preferredBundleId: string | null = null

  constructor(options: ComputerUseServiceOptions = {}) {
    this.policy = options.policy ?? new ComputerUsePolicy()
    this.adapter = options.adapter ?? new FakePlatformBackend()
    this.fake = this.adapter instanceof FakePlatformBackend ? this.adapter : null
    this.states = new StateStore(options.stateLimit)
    this.bypassPolicy = options.bypassPolicy ?? false
    this.clock = options.clock ?? (() => Date.now())
  }

  /** Test accessor. */
  getFake(): FakePlatformBackend {
    if (!this.fake) throw new Error('adapter is not FakePlatformBackend')
    return this.fake
  }

  getStateStore(): StateStore {
    return this.states
  }

  getScheduler(): ResourceScheduler {
    return this.scheduler
  }

  /**
   * After tool-layer image optimize (downscale), keep the stored state aligned
   * so subsequent act(x,y) uses the same coordinate space the agent saw.
   */
  alignStateVisual(
    stateId: string,
    image: { path?: string; mimeType?: string; width: number; height: number },
    coordinateSpace?: { width: number; height: number; scale: number; fullScreen: boolean },
  ): void {
    const state = this.states.get(stateId)
    if (!state) return
    if (image.path || image.width) {
      state.image = {
        mimeType: image.mimeType ?? state.image?.mimeType ?? 'image/png',
        path: image.path ?? state.image?.path,
        width: image.width,
        height: image.height,
      }
    }
    if (coordinateSpace) {
      state.coordinateSpace = { ...coordinateSpace }
    }
  }

  reset(): void {
    this.states.clear()
    this.scheduler.reset()
    this.roots.clear()
    this.policy.clearGrants()
    this.preferredBundleId = null
    this.fake?.reset()
    resetComputerUseIds()
  }

  /**
   * List running apps without the feature-enabled gate (Settings picker).
   */
  async listRunningApps(): Promise<RunningAppMeta[]> {
    const discovered = await this.adapter.listRoots().catch(() => [])
    this.roots.sync(discovered)
    if (this.fake) return this.fake.listAppsMeta()
    if (this.adapter.listApps) return this.adapter.listApps()
    return uniqueApps(discovered)
  }

  /**
   * Discoverable UI roots (`@rN`) after a refresh — for multi-window targeting
   * and tests. Prefer computer_apps list (catalog) for finding apps.
   */
  async listUiRoots(): Promise<
    Array<{
      rootId: string
      kind: UiRootIdentity['kind']
      app: string
      bundleId: string
      pid: number
      title: string
      focused: boolean
      modal: boolean
    }>
  > {
    await this.refreshRoots()
    return this.roots.list().map((r) => ({
      rootId: r.rootId,
      kind: r.kind,
      app: r.app,
      bundleId: r.bundleId,
      pid: r.pid,
      title: r.title,
      focused: r.focused,
      modal: r.modal,
    }))
  }

  /**
   * Resolve which app a tool call will touch (for HITL grant before observe/act).
   * Defaults to the focused root when rootId is omitted.
   */
  async resolveTargetRoot(rootId?: string): Promise<UiRootIdentity> {
    await this.refreshRoots()
    return this.resolveRoot(rootId)
  }

  /**
   * Map a user/agent app name (any locale) or reverse-DNS bundle id to a concrete
   * identity. Prefer running apps; fall back to installed-app LaunchServices /
   * localized Info.plist scan. Never returns a display name as a fake bundleId.
   */
  async resolveAppIdentity(appQuery: string): Promise<{ app: string; bundleId: string }> {
    const q = appQuery.trim()
    if (!q) {
      throw new ComputerUseError('INVALID_ACTION', 'app is required')
    }
    const discovered = await this.adapter.listRoots()
    this.roots.sync(discovered)

    let running: RunningAppMeta[]
    if (this.fake) {
      running = this.fake.listAppsMeta()
    } else if (this.adapter.listApps) {
      running = await this.adapter.listApps()
    } else {
      running = uniqueApps(discovered)
    }

    // Resolve installed identity first so Chinese names (豆包) map to real
    // bundle ids even when the process is already running under "Doubao".
    const { resolveInstalledApp } = await import('./resolve-installed-app')
    const installed = this.fake ? null : await resolveInstalledApp(q)
    const aliases = installed?.aliases ?? []

    const hit = matchRunningApp(running, q, aliases)
      ?? (installed
        ? matchRunningApp(running, installed.bundleId, installed.aliases)
        : undefined)
    if (hit) {
      return {
        app: hit.app || installed?.app || q,
        bundleId: hit.bundleId,
      }
    }

    if (installed) {
      return { app: installed.app, bundleId: installed.bundleId }
    }

    // Fake backend / tests: allow bare names that match running entries only
    // was already tried; if query looks like a bundle id, accept it for launch.
    if (looksLikeBundleId(q)) {
      return { app: q, bundleId: q }
    }

    throw new ComputerUseError(
      'APP_NOT_FOUND',
      `Cannot resolve app "${q}" to an installed bundle id. Pass a name/bundleId from computer_apps list (use query=), or a reverse-DNS bundle id (e.g. com.apple.TextEdit).`,
      { query: q },
    )
  }

  // ── computer_apps ────────────────────────────────────────

  async apps(
    action: 'list' | 'focus' | 'launch' = 'list',
    app?: string,
    listOptions: AppsListOptions = {},
  ): Promise<AppsSnapshot> {
    this.requireEnabled()

    if (action === 'list') {
      return this.listAppCatalog(listOptions)
    }

    if (!app) {
      throw new ComputerUseError('INVALID_ACTION', `${action} requires app`)
    }

    // Resolve to a real bundle id before focus/launch so grants and matching
    // stay stable across locale names (豆包 vs Doubao vs com.bot.pc.doubao).
    const identity = await this.resolveAppIdentity(app)
    const resolvedQuery = identity.bundleId
    const resolveAliases = [app, identity.app, identity.bundleId]
    if (action === 'focus') {
      await this.adapter.focusApp?.(identity.bundleId)
    } else {
      await this.adapter.launchApp?.(identity.bundleId)
    }

    const discovered = await this.adapter.listRoots()
    this.roots.sync(discovered)

    let running: RunningAppMeta[]
    if (this.fake) {
      running = this.fake.listAppsMeta()
    } else if (this.adapter.listApps) {
      running = await this.adapter.listApps()
    } else {
      running = uniqueApps(discovered)
    }

    // Only match the resolved identity — never adopt an unrelated newly-running
    // process (would escalate grants / wrong app).
    let target = matchRunningApp(running, resolvedQuery, resolveAliases)

    // NSWorkspace launch completion is asynchronous. Keep that race inside the
    // launch tool so callers do not need a follow-up snapshot just to confirm it.
    for (let attempt = 0; action === 'launch' && !target && attempt < 10; attempt += 1) {
      await sleep(100)
      running = await this.listRunningApps()
      target = matchRunningApp(running, resolvedQuery, resolveAliases)
    }

    // Wait for a discoverable window root so launch can return rootId for snapshot.
    let targetRootId: string | undefined
    if (target) {
      this.preferredBundleId = target.bundleId
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (attempt > 0) {
          await sleep(100)
          const discoveredAgain = await this.adapter.listRoots()
          this.roots.sync(discoveredAgain)
        }
        const root = this.roots
          .list()
          .find((r) => r.bundleId === target!.bundleId)
        if (root) {
          targetRootId = root.rootId
          break
        }
      }
    }

    const result: AppsActionResult = {
      action,
      frontmost: running.find((r) => r.frontmost)?.app ?? null,
      clipboardGrant: this.policy.hasClipboardGrant(),
      ...(target
        ? {
            target: {
              app: target.app,
              bundleId: target.bundleId,
              pid: target.pid,
              ...(targetRootId ? { rootId: targetRootId } : {}),
            },
          }
        : {}),
    }
    return result
  }

  private async listAppCatalog(options: AppsListOptions): Promise<AppsListResult> {
    const query = options.query?.trim() || null
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 25)))

    const discovered = await this.adapter.listRoots()
    this.roots.sync(discovered)

    let running: RunningAppMeta[]
    if (this.fake) {
      running = this.fake.listAppsMeta()
    } else if (this.adapter.listApps) {
      running = await this.adapter.listApps()
    } else {
      running = uniqueApps(discovered)
    }

    const windowCountByBundle = new Map<string, number>()
    for (const root of this.roots.list()) {
      if (!root.bundleId) continue
      windowCountByBundle.set(
        root.bundleId,
        (windowCountByBundle.get(root.bundleId) ?? 0) + 1,
      )
    }

    const runningByBundle = new Map(running.map((r) => [r.bundleId, r]))
    const grantByBundle = new Map(
      this.policy.listGranted()
        .filter((g) => g.bundleId !== '*')
        .map((g) => [g.bundleId, g]),
    )
    const allowAll = this.policy.isAllowAllApps()

    // Seed catalog from installed apps (macOS) + always include running processes
    // even if not under /Applications (e.g. dev Electron builds).
    const byBundle = new Map<string, {
      app: string
      bundleId: string
      aliases: string[]
    }>()

    if (!this.fake) {
      try {
        const { listInstalledApps } = await import('./resolve-installed-app')
        for (const installed of listInstalledApps()) {
          byBundle.set(installed.bundleId, {
            app: installed.app,
            bundleId: installed.bundleId,
            aliases: installed.aliases,
          })
        }
      } catch {
        // ignore scan failures — fall back to running only
      }
    }

    for (const r of running) {
      const existing = byBundle.get(r.bundleId)
      if (existing) {
        if (r.app && !existing.aliases.includes(r.app)) existing.aliases.push(r.app)
        // Prefer live process display name when present.
        if (r.app) existing.app = r.app
      } else {
        byBundle.set(r.bundleId, {
          app: r.app || r.bundleId,
          bundleId: r.bundleId,
          aliases: [r.app, r.bundleId].filter(Boolean),
        })
      }
    }

    // Also surface always-allow entries that aren't installed/running yet.
    for (const g of grantByBundle.values()) {
      if (byBundle.has(g.bundleId)) continue
      byBundle.set(g.bundleId, {
        app: g.app || g.bundleId,
        bundleId: g.bundleId,
        aliases: [g.app, g.bundleId].filter(Boolean),
      })
    }

    const qLower = query?.toLowerCase() ?? null
    let entries: AppCatalogEntry[] = []
    for (const meta of byBundle.values()) {
      if (qLower) {
        const hay = [meta.app, meta.bundleId, ...meta.aliases]
          .join('\0')
          .toLowerCase()
        if (!hay.includes(qLower)) continue
      }
      const live = runningByBundle.get(meta.bundleId)
      const grant = grantByBundle.get(meta.bundleId)
      const granted = allowAll || !!grant
      entries.push({
        app: meta.app,
        bundleId: meta.bundleId,
        running: !!live,
        frontmost: live?.frontmost ?? false,
        granted,
        grantScope: grant?.scope ?? null,
        pid: live?.pid ?? null,
        windows: windowCountByBundle.get(meta.bundleId) ?? 0,
      })
    }

    // Running / frontmost / granted first, then alpha — so page 0 is useful.
    entries.sort((a, b) => {
      if (a.frontmost !== b.frontmost) return a.frontmost ? -1 : 1
      if (a.running !== b.running) return a.running ? -1 : 1
      if (a.granted !== b.granted) return a.granted ? -1 : 1
      return a.app.localeCompare(b.app)
    })

    const total = entries.length
    const page = entries.slice(offset, offset + limit)

    const result: AppsListResult = {
      action: 'list',
      frontmost: running.find((r) => r.frontmost)?.app ?? null,
      clipboardGrant: this.policy.hasClipboardGrant(),
      query,
      total,
      offset,
      limit,
      hasMore: offset + page.length < total,
      apps: page,
    }

    if (options.includeRoots) {
      result.roots = this.roots.list().map((r) => ({
        rootId: r.rootId,
        kind: r.kind,
        app: r.app,
        bundleId: r.bundleId,
        pid: r.pid,
        title: r.title,
        focused: r.focused,
        modal: r.modal,
      }))
    }

    return result
  }

  // ── computer_snapshot ─────────────────────────────────────

  async observe(
    rootId?: string,
    mode: ObserveMode = 'fused',
    capture: CaptureScope = 'window',
  ): Promise<ObserveResult> {
    this.requireEnabled()
    await this.refreshRoots()
    const root = this.resolveRoot(rootId)
    this.requireGranted(root.bundleId)

    return this.scheduler.runExclusive(root.resourceKey, async () => {
      const look = await this.adapter.look(root, mode, capture)
      // Keep root identity stable; merge latest meta.
      const identity: UiRootIdentity = {
        ...look.root,
        rootId: root.rootId,
      }
      this.roots.register(identity)

      const epoch = this.scheduler.ensure(identity.resourceKey)
      const stateId = nextStateId()
      const state = {
        stateId,
        resourceKey: identity.resourceKey,
        epoch,
        root: identity,
        capturedAt: this.clock(),
        outline: look.outline,
        image: look.image,
        coordinateSpace: look.coordinateSpace,
        mode,
        capture,
        nativeLookId: look.nativeLookId,
      }
      this.states.put(state)

      const folded = foldOutline(look.outline)
      return {
        stateId,
        root: identity,
        image: look.image,
        outline: folded.outline,
        truncation: {
          nodesOmitted: folded.nodesOmitted,
          maxDepth: folded.maxDepth,
        },
        coordinateSpace: look.coordinateSpace,
        mode,
        capture,
      }
    })
  }

  // ── computer_zoom ────────────────────────────────────────

  async zoom(
    stateId: string,
    region: [number, number, number, number],
  ): Promise<ZoomResult> {
    this.requireEnabled()
    const state = this.requireState(stateId)
    this.requireGranted(state.root.bundleId)

    const image = this.adapter.zoom
      ? await this.adapter.zoom(state.root, region, state.coordinateSpace)
      : {
          mimeType: 'image/png' as const,
          data: `zoom:${region.join(',')}`,
          width: Math.max(1, region[2] - region[0]),
          height: Math.max(1, region[3] - region[1]),
        }

    return {
      image,
      region,
      // Critical invariant: zoom never establishes a new coordinate space.
      coordinateSpace: { ...state.coordinateSpace },
      stateId,
      // Surface target identity so chat UI can show the app icon without a second lookup.
      root: {
        app: state.root.app,
        bundleId: state.root.bundleId,
        title: state.root.title,
      },
    }
  }

  // ── computer_query ───────────────────────────────────────

  async query(
    stateId: string,
    op: 'search' | 'expand' | 'inspect',
    args: { text?: string; ref?: string; depth?: number } = {},
  ): Promise<QueryResult> {
    this.requireEnabled()
    const state = this.requireState(stateId)
    const root = targetIdentity(state.root)
    // Query is read-only on cached state — no grant re-check beyond existence,
    // but still require the feature be enabled. Refs are state-scoped.

    if (op === 'search') {
      if (!args.text) {
        throw new ComputerUseError('INVALID_ACTION', 'search requires text')
      }
      return { matches: searchOutline(state.outline, args.text), root }
    }
    if (op === 'expand') {
      if (!args.ref) {
        throw new ComputerUseError('INVALID_ACTION', 'expand requires ref')
      }
      const subtree = expandSubtree(state.outline, args.ref, args.depth ?? 3)
      if (!subtree) {
        throw new ComputerUseError('UNKNOWN_REF', `ref ${args.ref} not in ${stateId}`, {
          ref: args.ref,
          stateId,
        })
      }
      return { subtree, root }
    }
    // inspect
    if (!args.ref) {
      throw new ComputerUseError('INVALID_ACTION', 'inspect requires ref')
    }
    const element = findNode(state.outline, args.ref)
    if (!element) {
      throw new ComputerUseError('UNKNOWN_REF', `ref ${args.ref} not in ${stateId}`, {
        ref: args.ref,
        stateId,
      })
    }
    // Return node without children for a compact inspect.
    const { children: _c, ...rest } = element
    return { element: rest, root }
  }

  // ── computer_act ─────────────────────────────────────────

  async act(
    stateId: string,
    actionsInput: unknown,
    options: {
      expect?: Condition
      delivery?: DeliveryMode
    } = {},
  ): Promise<ActResult> {
    this.requireEnabled()
    const base = this.requireState(stateId)
    this.requireGranted(base.root.bundleId)

    const actions = parseActions(actionsInput)
    // Default: app-directed (background postToPid). Does not steal the user's frontmost app.
    // physical = global HID (requires frontmost; disruptive). semantic = AX (P3).
    const delivery = options.delivery ?? 'app-directed'

    for (const a of actions) {
      this.requireActionAllowed(base.root.bundleId, a)
    }

    // Semantic delivery must never silently upgrade to physical / app-directed.
    if (delivery === 'semantic') {
      const needsPhysical = actions.some(
        (a) => a.type === 'click' || a.type === 'typeText' || a.type === 'keypress' || a.type === 'drag',
      )
      // Still pass through — adapter fails closed if semantic unsupported.
      void needsPhysical
    }

    // Global HID only: require target to be frontmost (events go to system pointer).
    // app-directed posts to the target PID and must not force activation.
    if (delivery === 'physical') {
      await this.assertFrontmost(base.root.bundleId)
    }

    return this.scheduler.runExclusive(base.resourceKey, async () => {
      await this.refreshRoots()
      const currentRoot = this.roots.get(base.root.rootId)
      const nativeIdentityChanged =
        !currentRoot
        || currentRoot.pid !== base.root.pid
        || currentRoot.resourceKey !== base.root.resourceKey
        || currentRoot.windowId !== base.root.windowId
        || currentRoot.axRootId !== base.root.axRootId
      if (nativeIdentityChanged) {
        throw new ComputerUseError(
          'STALE_STATE',
          `Stale state ${stateId}: target window is no longer available`,
          {
            stateId,
            rootId: base.root.rootId,
            expectedWindowId: base.root.windowId,
            currentWindowId: currentRoot?.windowId,
          },
        )
      }

      const blockingModals = this.roots.list().filter(
        (root) => root.rootId !== currentRoot.rootId
          && root.resourceKey === currentRoot.resourceKey
          && root.pid === currentRoot.pid
          && root.modal
          && root.visible
          && !root.minimized,
      )
      if (blockingModals.length > 0) {
        throw new ComputerUseError(
          'MODAL_BLOCKED',
          `Window ${currentRoot.rootId} is blocked by modal ${blockingModals[0]!.rootId}`,
          {
            stateId,
            rootId: currentRoot.rootId,
            modalRoots: blockingModals.map((root) => ({
              rootId: root.rootId,
              kind: root.kind,
              title: root.title,
            })),
          },
        )
      }

      let claimedEpoch: number
      try {
        claimedEpoch = this.scheduler.claimWrite(base.resourceKey, base.epoch)
      } catch (err) {
        const e = err as { code?: string; currentEpoch?: number; expectedEpoch?: number }
        if (e.code === 'STALE_STATE') {
          throw new ComputerUseError(
            'STALE_STATE',
            `Stale state ${stateId}: resource epoch moved (expected ${base.epoch}, current ${e.currentEpoch})`,
            {
              stateId,
              resourceKey: base.resourceKey,
              expectedEpoch: base.epoch,
              currentEpoch: e.currentEpoch,
            },
          )
        }
        throw err
      }

      // Epoch already advanced — side effects may proceed.
      void claimedEpoch

      const platformResult = await this.adapter.act({
        root: base.root,
        actions,
        delivery,
        coordinateSpace: base.coordinateSpace,
        outline: base.outline,
      })

      // Re-observe successor (same resource). Prefer fused/semantic so outcome
      // heuristics can read AX values; visual-only stays picture-only.
      const reobserveMode = base.mode === 'visual' ? 'visual' : base.mode
      let successorRoot = base.root
      let look: PlatformLook
      try {
        look = await this.adapter.look(base.root, reobserveMode, base.capture)
      } catch (error) {
        if (!base.root.axRootId) throw error
        const replacement = await this.waitForTransientSuccessor(base.root)
        if (!replacement) throw error
        successorRoot = replacement
        look = await this.adapter.look(successorRoot, reobserveMode, base.capture)
      }

      const mayCloseTransient = base.root.axRootId && actions.some(
        (action) => action.type === 'press'
          || action.type === 'click'
          || action.type === 'keypress',
      )
      if (mayCloseTransient && successorRoot.rootId === base.root.rootId) {
        const replacement = await this.waitForTransientSuccessor(base.root)
        if (replacement) {
          successorRoot = replacement
          look = await this.adapter.look(successorRoot, reobserveMode, base.capture)
        }
      }
      const identity: UiRootIdentity = { ...look.root, rootId: successorRoot.rootId }
      this.roots.register(identity)

      const successorEpoch = this.scheduler.epoch(base.resourceKey)
      const successorStateId = nextStateId()
      const successor = {
        stateId: successorStateId,
        resourceKey: identity.resourceKey,
        epoch: successorEpoch,
        root: identity,
        capturedAt: this.clock(),
        outline: look.outline,
        image: look.image,
        coordinateSpace: look.coordinateSpace,
        mode: base.mode,
        capture: base.capture,
        nativeLookId: look.nativeLookId,
      }
      this.states.put(successor)

      const evidence = platformResult.steps.map((s) => ({
        description: s.description,
        before: s.before,
        after: s.after,
      }))

      const diff = buildDiff(base.outline, successor.outline)

      let expectHolds: boolean | null = null
      if (options.expect) {
        const binding = bindCondition(options.expect, base.outline)
        expectHolds = evaluateBoundCondition(binding, successor.outline)
      }

      const finalOutcome = refineActOutcome({
        steps: platformResult.steps,
        actions,
        successorOutline: successor.outline,
        diff,
        expectHolds,
      })

      return {
        outcome: finalOutcome,
        evidence,
        grounding: delivery,
        stoppedAt: platformResult.stoppedAt,
        successorStateId,
        successorRoot: identity,
        successorImage: successor.image,
        successorCoordinateSpace: successor.coordinateSpace,
        diff,
      }
    })
  }

  // ── computer_wait_for ────────────────────────────────────

  async waitFor(
    stateId: string,
    condition: Condition,
    timeoutMs = 5000,
  ): Promise<WaitResult> {
    this.requireEnabled()
    const base = this.requireState(stateId)
    this.requireGranted(base.root.bundleId)
    const binding = bindCondition(condition, base.outline)

    // preexisting: condition already true on base state
    if (evaluateBoundCondition(binding, base.outline)) {
      // Still produce a successor observation for a stable stateId contract.
      const obs = await this.observe(base.root.rootId, base.mode, base.capture)
      return {
        status: 'preexisting',
        successorStateId: obs.stateId,
        successorRoot: targetIdentity(obs.root),
      }
    }

    const interval = 50
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / interval))
    for (let i = 0; i < maxAttempts; i++) {
      if (this.fake) this.fake.advanceTime(interval)
      else await sleep(interval)

      const obs = await this.observe(base.root.rootId, base.mode, base.capture)
      const state = this.requireState(obs.stateId)
      if (evaluateBoundCondition(binding, state.outline)) {
        return {
          status: 'verified',
          successorStateId: obs.stateId,
          successorRoot: targetIdentity(obs.root),
        }
      }
    }

    const last = await this.observe(base.root.rootId, base.mode, base.capture)
    return {
      status: 'failed',
      successorStateId: last.stateId,
      successorRoot: targetIdentity(last.root),
    }
  }

  /**
   * Bound a JSON-serialized payload for tool replies (output limit contract).
   */
  boundJson(value: unknown): { text: string; truncated: boolean; continuationRef?: string } {
    const raw = JSON.stringify(value)
    const bound = boundText(raw)
    return {
      text: bound.text,
      truncated: bound.truncated,
      continuationRef: bound.continuationRef,
    }
  }

  // ── internals ────────────────────────────────────────────

  private requireEnabled(): void {
    if (this.bypassPolicy) return
    this.policy.assertEnabled()
  }

  private requireGranted(bundleId: string): void {
    if (this.bypassPolicy) return
    this.policy.assertGranted(bundleId)
  }

  private requireActionAllowed(bundleId: string, action: UiAction): void {
    if (this.bypassPolicy) return
    this.policy.assertActionAllowed(bundleId, action.type)
    if (action.type === 'click') {
      this.policy.assertClickButton(bundleId, action.button ?? 'left')
    }
  }

  /**
   * Frontmost gate for delivery=physical (global HID) only.
   * app-directed / semantic must not call this — background Computer Use is the default.
   */
  private async assertFrontmost(bundleId: string): Promise<void> {
    if (this.bypassPolicy) return
    if (!this.adapter.frontmost) return
    const front = await this.adapter.frontmost()
    if (!front) {
      throw new ComputerUseError(
        'BACKEND',
        'Unable to determine frontmost app before physical (global HID) input',
      )
    }
    if (front.bundleId !== bundleId) {
      throw new ComputerUseError(
        'TIER_BLOCKED',
        `Foreground gate (delivery=physical only): frontmost is ${front.app} (${front.bundleId}), target is ${bundleId}. Prefer default delivery=app-directed for background control, or focus the target app first.`,
        { frontmost: front.bundleId, target: bundleId },
      )
    }
  }

  /** Bundle IDs currently on the session allowlist (for capture exclusion). */
  grantedBundleIds(): string[] {
    if (this.policy.isAllowAllApps()) return []
    return this.policy.listGranted().map((g) => g.bundleId).filter((id) => id !== '*')
  }

  /** When true, capture excludes no apps (full desktop). */
  isAllowAllApps(): boolean {
    return this.policy.isAllowAllApps()
  }

  /** Sync feature flags + always-allow list from AppSettings into this session's policy. */
  syncSettingsFlags(flags: {
    enabled?: boolean
    allowAllApps?: boolean
    alwaysAllowApps?: Array<{ app: string; bundleId: string }>
  }): void {
    if (flags.enabled !== undefined) this.policy.setEnabled(flags.enabled)
    if (flags.allowAllApps !== undefined) this.policy.setAllowAllApps(flags.allowAllApps)
    if (flags.alwaysAllowApps !== undefined) {
      this.policy.setAlwaysAllowApps(flags.alwaysAllowApps)
    }
  }

  /**
   * Drop software-cursor + menu-bar chip. Safe no-op when the platform has no overlay.
   * Used when the agent stops controlling (turn ended / interrupted / session disposed).
   */
  async clearVisuals(): Promise<void> {
    try {
      await this.adapter.clearVisuals?.()
    } catch {
      // non-fatal
    }
  }

  private requireState(stateId: string) {
    const state = this.states.get(stateId)
    if (!state) {
      throw new ComputerUseError('UNKNOWN_STATE', `Unknown stateId ${stateId}`, { stateId })
    }
    return state
  }

  private async refreshRoots(): Promise<void> {
    const discovered = await this.adapter.listRoots()
    this.roots.sync(discovered)
  }

  private async waitForTransientSuccessor(
    transient: UiRootIdentity,
  ): Promise<UiRootIdentity | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(40)
      await this.refreshRoots()
      const refreshedTarget = this.roots.get(transient.rootId)
      if (refreshedTarget?.axRootId === transient.axRootId) continue

      const candidates = this.roots.list().filter(
        (root) => root.resourceKey === transient.resourceKey && root.rootId !== transient.rootId,
      )
      const replacement = candidates.find((root) => root.focused)
        ?? candidates.find((root) => root.modal)
        ?? candidates.find((root) => root.kind === 'window')
        ?? candidates[0]
      if (replacement) return replacement
    }
    return undefined
  }

  private resolveRoot(rootId?: string): UiRootIdentity {
    if (rootId) {
      const r = this.roots.get(rootId)
      if (!r) {
        throw new ComputerUseError('UNKNOWN_ROOT', `Unknown root ${rootId}`, { rootId })
      }
      return r
    }
    const list = this.roots.list()
    // Prefer last launch/focus target over OS frontmost (often SuperOne).
    if (this.preferredBundleId) {
      const preferred =
        list.find((r) => r.bundleId === this.preferredBundleId && r.focused)
        ?? list.find((r) => r.bundleId === this.preferredBundleId)
      if (preferred) return preferred
    }
    const focused = list.find((r) => r.focused) ?? list[0]
    if (!focused) {
      throw new ComputerUseError('UNKNOWN_ROOT', 'No UI roots available')
    }
    return focused
  }
}

function buildDiff(
  before: import('./types').UiOutlineNode,
  after: import('./types').UiOutlineNode,
): StateDiff {
  const d = diffOutlines(before, after)
  const beforeRefs = new Set(collectRefs(before))
  const afterRefs = new Set(collectRefs(after))
  // If almost nothing overlaps, identity is ambiguous → full view fallback.
  let overlap = 0
  for (const r of afterRefs) if (beforeRefs.has(r)) overlap += 1
  const fullViewFallback =
    beforeRefs.size > 0 && afterRefs.size > 0 && overlap / Math.max(beforeRefs.size, afterRefs.size) < 0.2

  return {
    added: d.added,
    removed: d.removed,
    changed: d.changed,
    fullViewFallback,
  }
}

export function evaluateCondition(
  condition: Condition,
  outline: import('./types').UiOutlineNode,
): boolean {
  switch (condition.kind) {
    case 'exists':
      return !!findNode(outline, condition.ref)
    case 'notExists':
      return !findNode(outline, condition.ref)
    case 'textEquals': {
      const n = findNode(outline, condition.ref)
      return !!n && (n.name === condition.text || n.value === condition.text)
    }
    case 'textContains': {
      const n = findNode(outline, condition.ref)
      if (!n) return false
      return (n.name ?? '').includes(condition.text) || (n.value ?? '').includes(condition.text)
    }
    case 'valueEquals': {
      const n = findNode(outline, condition.ref)
      return !!n && n.value === condition.value
    }
    default: {
      const _e: never = condition
      return _e
    }
  }
}

interface ConditionBinding {
  condition: Condition
  target?: import('./types').UiOutlineNode
  matchName: boolean
}

type ConditionTargetResolution =
  | { status: 'found'; node: import('./types').UiOutlineNode }
  | { status: 'missing' | 'ambiguous' }

function bindCondition(
  condition: Condition,
  outline: import('./types').UiOutlineNode,
): ConditionBinding {
  return {
    condition,
    target: findNode(outline, condition.ref),
    // Text conditions may intentionally wait for either name or value to change.
    matchName: condition.kind !== 'textEquals' && condition.kind !== 'textContains',
  }
}

function evaluateBoundCondition(
  binding: ConditionBinding,
  outline: import('./types').UiOutlineNode,
): boolean {
  if (!binding.target) {
    // Preserve missing-ref behavior for callers waiting on a future raw ref.
    return evaluateCondition(binding.condition, outline)
  }

  const resolution = resolveConditionTarget(binding, outline)
  if (binding.condition.kind === 'notExists') {
    return resolution.status === 'missing'
  }
  if (resolution.status !== 'found') return false

  const node = resolution.node
  switch (binding.condition.kind) {
    case 'exists':
      return true
    case 'textEquals':
      return node.name === binding.condition.text || node.value === binding.condition.text
    case 'textContains':
      return (node.name ?? '').includes(binding.condition.text)
        || (node.value ?? '').includes(binding.condition.text)
    case 'valueEquals':
      return node.value === binding.condition.value
    default: {
      const _condition: never = binding.condition
      return _condition
    }
  }
}

function resolveConditionTarget(
  binding: ConditionBinding,
  outline: import('./types').UiOutlineNode,
): ConditionTargetResolution {
  const expected = binding.target!
  const candidates: import('./types').UiOutlineNode[] = []
  const stack = [outline]
  while (stack.length) {
    const node = stack.pop()!
    if (
      node.role === expected.role
      && node.pictureOnly === expected.pictureOnly
      && (!binding.matchName || node.name === expected.name)
    ) {
      candidates.push(node)
    }
    if (node.children) stack.push(...node.children)
  }

  if (candidates.length === 0) return { status: 'missing' }
  if (candidates.length === 1) return { status: 'found', node: candidates[0]! }
  if (!expected.bounds) return { status: 'ambiguous' }

  const ranked = candidates
    .filter((node) => node.bounds)
    .map((node) => ({ node, distance: boundsDistance(expected.bounds!, node.bounds!) }))
    .sort((a, b) => a.distance - b.distance)
  if (ranked.length === 0) return { status: 'ambiguous' }
  if (ranked.length === 1 || ranked[0]!.distance + 0.5 < ranked[1]!.distance) {
    return { status: 'found', node: ranked[0]!.node }
  }
  return { status: 'ambiguous' }
}

function boundsDistance(a: import('./types').Bounds, b: import('./types').Bounds): number {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by, a.width - b.width, a.height - b.height)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
