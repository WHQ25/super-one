import { listAppCatalog } from './app-catalog'
import { newRootMatches, selectNewAppRoot } from './new-root'
import { zoomState } from './zoom-state'
import { queryState } from './query-state'
import { bindCondition, evaluateBoundCondition } from './condition-evaluation'
export { evaluateCondition } from './condition-evaluation'
import { buildDiff } from './state-diff'
import { sleep, throwIfAborted } from './async-control'
import { ContextMenuLedger } from './context-menu'
import { waitForCondition } from './wait-for'
import { parseActions } from './actions'
import {
  looksLikeBundleId,
  matchRunningApp,
  targetIdentity,
  uniqueApps,
} from './app-identity'
import { refineActOutcome } from './outcome'
import {
  findNode,
  foldOutline,
} from './outline'
import { compactOutline, dropOccludedWebAreas } from './outline-compact'
import { ComputerUsePolicy } from './policy'
import { FakePlatformBackend } from './platform/fake-backend'
import type { PlatformAdapter } from './platform/types'
import type { PlatformLook } from './platform/types'
import { ResourceScheduler } from './resource-scheduler'
import { boundText, clearContinuations } from './result-view'
import { RootRegistry } from './root-registry'
import { resolveUiRoot, selectAppRoot } from './root-selection'
import { StateStore } from './state-store'
import {
  ComputerUseError,
  type ActResult,
  type AppsActionResult,
  type AppsFocusOptions,
  type AppsListOptions,
  type AppsListResult,
  type AppsSnapshot,
  type CaptureScope,
  type Condition,
  type ObserveMode,
  type ObserveResult,
  type QueryResult,
  type UiAction,
  type UiOutlineNode,
  type UiRootIdentity,
  type WaitResult,
  type ZoomResult,
} from './types'

/** How long an unchanged successor outline is re-read before it counts as unchanged. */
const ACT_SETTLE_MS = 600
const ACT_SETTLE_POLL_MS = 80

function outlineMoved(before: UiOutlineNode, after: UiOutlineNode): boolean {
  const d = buildDiff(before, after)
  return d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0
}

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
  private readonly menus: ContextMenuLedger

  constructor(options: ComputerUseServiceOptions = {}) {
    this.policy = options.policy ?? new ComputerUsePolicy()
    this.adapter = options.adapter ?? new FakePlatformBackend()
    this.fake = this.adapter instanceof FakePlatformBackend ? this.adapter : null
    this.states = new StateStore(options.stateLimit)
    this.bypassPolicy = options.bypassPolicy ?? false
    this.clock = options.clock ?? (() => Date.now())
    this.menus = new ContextMenuLedger({
      adapter: this.adapter,
      roots: this.roots,
      refreshRoots: () => this.refreshRoots(),
      delay: (ms, signal) => this.delay(ms, signal),
    })
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
   * An explicit root is exact. Otherwise select a usable content root in the
   * requested app, the last launch/focus app, or the frontmost app.
   */
  async resolveTargetRoot(rootId?: string, bundleId?: string): Promise<UiRootIdentity> {
    await this.refreshRoots()
    return resolveUiRoot(this.roots.list(), { rootId, bundleId, preferredBundleId: this.preferredBundleId })
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
    options: AppsListOptions & AppsFocusOptions = {},
  ): Promise<AppsSnapshot> {
    this.requireEnabled()

    if (action === 'list') {
      return this.listAppCatalog(options)
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
      await this.adapter.focusApp?.(identity.bundleId, { activate: options.activate === true })
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
        const root = selectAppRoot(this.roots.list().filter((r) => r.bundleId === target!.bundleId))
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

  private listAppCatalog(options: AppsListOptions): Promise<AppsListResult> {
    return listAppCatalog(options, { adapter: this.adapter, fake: this.fake, roots: this.roots, policy: this.policy })
  }

  // ── computer_snapshot ─────────────────────────────────────

  async observe(
    rootId?: string,
    mode: ObserveMode = 'fused',
    capture: CaptureScope = 'window',
  ): Promise<ObserveResult> {
    this.requireEnabled()
    await this.refreshRoots()
    const dismissedMenu = rootId !== undefined && this.menus.isDismissed(rootId)
    const root = dismissedMenu ? await this.menus.reopen(rootId!) : this.resolveRoot(rootId)
    this.requireGranted(root.bundleId)

    return this.scheduler.runExclusive(root.resourceKey, async () => {
      const look = await this.adapter.look(root, mode, capture)
      // Keep root identity stable; merge latest meta.
      const identity: UiRootIdentity = {
        ...look.root,
        rootId: root.rootId,
      }
      this.roots.register(identity)
      if (dismissedMenu) await this.menus.dismissAgain(root.rootId)

      const epoch = this.scheduler.ensure(identity.resourceKey)
      const stateId = nextStateId()
      const state = {
        stateId,
        resourceKey: identity.resourceKey,
        epoch,
        root: identity,
        observedRootIds: this.roots.list().filter((candidate) => candidate.bundleId === root.bundleId && candidate.pid === root.pid).map((candidate) => candidate.rootId),
        capturedAt: this.clock(),
        outline: look.outline,
        image: look.image,
        coordinateSpace: look.coordinateSpace,
        mode,
        capture,
        nativeLookId: look.nativeLookId,
      }
      this.states.put(state)

      const folded = foldOutline(compactOutline(dropOccludedWebAreas(look.outline)))
      return {
        stateId,
        root: identity,
        image: look.image,
        outline: folded.outline,
        truncation: {
          nodesOmitted: folded.nodesOmitted,
          maxDepth: folded.maxDepth,
          ...(look.outlineTruncated ? { sourceTruncated: true } : {}),
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

    if (!this.menus.isDismissed(state.root.rootId)) return zoomState(this.adapter, state, stateId, region)
    const root = await this.menus.reopen(state.root.rootId)
    try {
      return await zoomState(this.adapter, { ...state, root }, stateId, region)
    } finally {
      await this.menus.dismissAgain(root.rootId)
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
    return queryState(state, stateId, op, args)
  }

  // ── computer_act ─────────────────────────────────────────

  async act(
    stateId: string,
    actionsInput: unknown,
    options: {
      expect?: Condition
      recordingPath?: string
      signal?: AbortSignal
      timeoutMs?: number
    } = {},
  ): Promise<ActResult> {
    this.requireEnabled()
    throwIfAborted(options.signal)
    const stored = this.requireState(stateId)
    this.requireGranted(stored.root.bundleId)

    const actions = parseActions(actionsInput)
    // Every action runs in the background: an AX action on its ref, or an
    // event posted to the target app. Which one is the platform's choice per
    // action; nothing here activates the app or takes the user's input.
    for (const a of actions) {
      this.requireActionAllowed(stored.root.bundleId, a)
    }

    return this.scheduler.runExclusive(stored.resourceKey, async () => {
      throwIfAborted(options.signal)
      // A state taken from a dismissed context menu: bring the menu back
      // first, and act on it as it is now.
      const base = this.menus.isDismissed(stored.root.rootId)
        ? { ...stored, root: await this.menus.reopen(stored.root.rootId, options.signal) }
        : stored
      throwIfAborted(options.signal)
      await this.refreshRoots()
      throwIfAborted(options.signal)
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

      const menuTransaction = actions.every((action) => (action.type === 'press' || action.type === 'click')
        && action.ref && findNode(base.outline, action.ref)?.nativeTarget?.scope === 'menuBar')
      const blockingModals = this.roots.list().filter(
        (root) => root.rootId !== currentRoot.rootId
          && root.resourceKey === currentRoot.resourceKey
          && root.pid === currentRoot.pid
          && root.modal
          && !(menuTransaction && root.kind === 'menu')
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
      const rootsBefore = this.roots.list().map((root) => root.rootId)

      let recording: Awaited<ReturnType<NonNullable<PlatformAdapter['stopRecording']>>> | undefined
      let recordingActive = false
      try {
        if (options.recordingPath) {
          if (!this.adapter.startRecording || !this.adapter.stopRecording) {
            throw new ComputerUseError('INVALID_ACTION', 'Action recording is unavailable on this computer backend')
          }
          // Fail closed: the recorder must be running before the first side effect.
          await this.adapter.startRecording(base.root, options.recordingPath)
          recordingActive = true
          throwIfAborted(options.signal)
        }

        throwIfAborted(options.signal)
        const platformResult = await this.adapter.act({
          root: base.root,
          actions,
          coordinateSpace: base.coordinateSpace,
          outline: base.outline,
        })
        throwIfAborted(options.signal)

      // Re-observe successor (same resource). Prefer fused/semantic so outcome
      // heuristics can read AX values; visual-only stays picture-only.
      const reobserveMode = base.mode === 'visual' ? 'visual' : base.mode
      await this.refreshRoots()
      throwIfAborted(options.signal)
      let successorRoot = selectNewAppRoot(base.root, rootsBefore, this.roots.list(), options.expect?.kind === 'newRoot' ? options.expect : undefined) ?? base.root
      let look: PlatformLook
      try {
        look = await this.adapter.look(successorRoot, reobserveMode, base.capture)
        throwIfAborted(options.signal)
      } catch (error) {
        throwIfAborted(options.signal)
        if (!base.root.axRootId) throw error
        const replacement = await this.waitForTransientSuccessor(base.root, options.signal)
        if (!replacement) throw error
        successorRoot = replacement
        look = await this.adapter.look(successorRoot, reobserveMode, base.capture)
        throwIfAborted(options.signal)
      }

      const mayCloseTransient = base.root.axRootId && actions.some(
        (action) => action.type === 'press'
          || action.type === 'click'
          || action.type === 'keypress',
      )
      if (mayCloseTransient && successorRoot.rootId === base.root.rootId) {
        const replacement = await this.waitForTransientSuccessor(base.root, options.signal)
        if (replacement) {
          successorRoot = replacement
          look = await this.adapter.look(successorRoot, reobserveMode, base.capture)
          throwIfAborted(options.signal)
        }
      }
        let identity: UiRootIdentity = { ...look.root, rootId: successorRoot.rootId }
        this.roots.register(identity)

        let expectHolds: boolean | null = null
        if (options.expect) {
          const binding = bindCondition(options.expect, base.outline)
          const evaluate = () => options.expect!.kind === 'newRoot'
            ? !rootsBefore.includes(identity.rootId) && newRootMatches(options.expect as Extract<Condition, { kind: 'newRoot' }>, identity, look.outline)
            : evaluateBoundCondition(binding, look.outline)
          expectHolds = evaluate()
          const deadline = this.clock() + (options.timeoutMs ?? 5000)
          while (!expectHolds && this.clock() < deadline) {
            throwIfAborted(options.signal)
            if (this.fake) this.fake.advanceTime(50)
            else await sleep(50, options.signal)
            if (options.expect.kind === 'newRoot') {
              await this.refreshRoots()
              successorRoot = selectNewAppRoot(base.root, rootsBefore, this.roots.list(), options.expect) ?? successorRoot
              identity = successorRoot
            }
            look = await this.adapter.look(identity, reobserveMode, base.capture)
            throwIfAborted(options.signal)
            identity = { ...look.root, rootId: successorRoot.rootId }
            this.roots.register(identity)
            expectHolds = evaluate()
          }
        } else {
          // SwiftUI apps publish their accessibility update a few hundred
          // milliseconds after the action; a snapshot taken at once reports
          // "nothing changed" and every caller downstream believes it. Give an
          // unchanged outline a short chance to move before it becomes the fact.
          const deadline = this.clock() + ACT_SETTLE_MS
          while (this.clock() < deadline && !outlineMoved(base.outline, look.outline)) {
            throwIfAborted(options.signal)
            if (this.fake) this.fake.advanceTime(ACT_SETTLE_POLL_MS)
            else await sleep(ACT_SETTLE_POLL_MS, options.signal)
            look = await this.adapter.look(identity, reobserveMode, base.capture)
            throwIfAborted(options.signal)
            identity = { ...look.root, rootId: successorRoot.rootId }
          }
          if (recordingActive) {
            // Keep one visible tail frame when no explicit completion signal exists.
            await sleep(250, options.signal)
          }
        }

        if (recordingActive) {
          recording = await this.adapter.stopRecording!()
          recordingActive = false
        }

      const successorEpoch = this.scheduler.epoch(base.resourceKey)
      const successorStateId = nextStateId()
      const successor = {
        stateId: successorStateId,
        resourceKey: identity.resourceKey,
        epoch: successorEpoch,
        root: identity,
        observedRootIds: this.roots.list().filter((candidate) => candidate.bundleId === identity.bundleId && candidate.pid === identity.pid).map((candidate) => candidate.rootId),
        capturedAt: this.clock(),
        outline: look.outline,
        image: look.image,
        coordinateSpace: look.coordinateSpace,
        mode: base.mode,
        capture: base.capture,
        nativeLookId: look.nativeLookId,
      }
      this.states.put(successor)

      // A menu this action opened has been read into the successor; take it
      // down. A menu this action was replayed into, and did not close, too.
      await this.menus.dismissOpened(identity, rootsBefore, { base, actions })
      await this.menus.dismissAgain(base.root.rootId)

      const evidence = platformResult.steps.map((s) => ({
        description: s.description,
        before: s.before,
        after: s.after,
      }))

      const diff = buildDiff(base.outline, successor.outline)

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
        stoppedAt: platformResult.stoppedAt,
        successorStateId,
        successorRoot: identity,
        successorImage: successor.image,
        successorCoordinateSpace: successor.coordinateSpace,
        diff,
        ...(recording ? {
          recording: {
            savedPath: recording.path,
            mimeType: recording.mimeType,
            durationMs: recording.durationMs,
            ...(recording.width ? { width: recording.width } : {}),
            ...(recording.height ? { height: recording.height } : {}),
          },
        } : {}),
      }
      } finally {
        if (recordingActive) {
          try {
            await this.adapter.stopRecording!()
          } catch {
            // Preserve the action or observation failure while closing best-effort.
          }
        }
      }
    })
  }

  // ── computer_wait_for ────────────────────────────────────

  async waitFor(
    stateId: string,
    condition: Condition,
    timeoutMs = 5000,
    signal?: AbortSignal,
  ): Promise<WaitResult> {
    this.requireEnabled()
    throwIfAborted(signal)
    const base = this.requireState(stateId)
    this.requireGranted(base.root.bundleId)
    return waitForCondition(base, condition, timeoutMs, {
      observe: this.observe.bind(this),
      requireState: this.requireState.bind(this),
      delay: async (ms, signal) => { if (this.fake) this.fake.advanceTime(ms); else await sleep(ms, signal) },
      listRoots: async () => { await this.refreshRoots(); return this.roots.list() },
    }, signal)
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

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.fake) this.fake.advanceTime(ms)
    else await sleep(ms, signal)
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
    signal?: AbortSignal,
  ): Promise<UiRootIdentity | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      throwIfAborted(signal)
      if (attempt > 0) await sleep(40, signal)
      await this.refreshRoots()
      throwIfAborted(signal)
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
    return resolveUiRoot(this.roots.list(), { rootId, preferredBundleId: this.preferredBundleId })
  }
}
