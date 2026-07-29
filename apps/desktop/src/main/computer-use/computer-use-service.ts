import { parseActions } from './actions'
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
import { ResourceScheduler } from './resource-scheduler'
import { boundText, clearContinuations } from './result-view'
import { RootRegistry } from './root-registry'
import { StateStore } from './state-store'
import {
  ComputerUseError,
  type ActionOutcome,
  type ActResult,
  type AppsSnapshot,
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
    this.fake?.reset()
    resetComputerUseIds()
  }

  /**
   * List running apps without the feature-enabled gate (Settings picker).
   */
  async listRunningApps(): Promise<AppsSnapshot['running']> {
    const discovered = await this.adapter.listRoots().catch(() => [])
    this.roots.sync(discovered)
    if (this.fake) return this.fake.listAppsMeta()
    if (this.adapter.listApps) return this.adapter.listApps()
    return uniqueApps(discovered)
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
   * Map a user/agent app name or bundle id to a concrete identity via running apps.
   * Falls back to treating the string as both display name and bundle id.
   */
  async resolveAppIdentity(appQuery: string): Promise<{ app: string; bundleId: string }> {
    const q = appQuery.trim()
    if (!q) {
      throw new ComputerUseError('INVALID_ACTION', 'app is required')
    }
    const discovered = await this.adapter.listRoots()
    this.roots.sync(discovered)

    let running: AppsSnapshot['running']
    if (this.fake) {
      running = this.fake.listAppsMeta()
    } else if (this.adapter.listApps) {
      running = await this.adapter.listApps()
    } else {
      running = uniqueApps(discovered)
    }

    const lower = q.toLowerCase()
    const hit =
      running.find((r) => r.bundleId.toLowerCase() === lower)
      ?? running.find((r) => r.app.toLowerCase() === lower)
      ?? running.find((r) => r.app.toLowerCase().includes(lower))
    if (hit) return { app: hit.app, bundleId: hit.bundleId }

    // Not running — still allow grant by treating query as app name (launch path).
    return { app: q, bundleId: q.includes('.') ? q : q }
  }

  // ── computer_apps ────────────────────────────────────────

  async apps(
    action: 'list' | 'focus' | 'launch' = 'list',
    app?: string,
  ): Promise<AppsSnapshot> {
    this.requireEnabled()
    if (action === 'focus') {
      if (!app) throw new ComputerUseError('INVALID_ACTION', 'focus requires app')
      await this.adapter.focusApp?.(app)
    } else if (action === 'launch') {
      if (!app) throw new ComputerUseError('INVALID_ACTION', 'launch requires app')
      await this.adapter.launchApp?.(app)
    }

    const discovered = await this.adapter.listRoots()
    this.roots.sync(discovered)

    let running: AppsSnapshot['running']
    if (this.fake) {
      running = this.fake.listAppsMeta()
    } else if (this.adapter.listApps) {
      running = await this.adapter.listApps()
    } else {
      running = uniqueApps(discovered)
    }

    const rootList = this.roots.list()
    return {
      granted: this.policy.listGranted(),
      running,
      roots: rootList.map((r) => ({
        rootId: r.rootId,
        kind: r.kind,
        app: r.app,
        bundleId: r.bundleId,
        pid: r.pid,
        title: r.title,
        focused: r.focused,
        modal: r.modal,
      })),
      frontmost: running.find((r) => r.frontmost)?.app ?? null,
      clipboardGrant: this.policy.hasClipboardGrant(),
    }
  }

  // ── computer_observe ─────────────────────────────────────

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
    // Query is read-only on cached state — no grant re-check beyond existence,
    // but still require the feature be enabled. Refs are state-scoped.

    if (op === 'search') {
      if (!args.text) {
        throw new ComputerUseError('INVALID_ACTION', 'search requires text')
      }
      return { matches: searchOutline(state.outline, args.text) }
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
      return { subtree }
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
    return { element: rest }
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
      const look = await this.adapter.look(base.root, reobserveMode, base.capture)
      const identity: UiRootIdentity = { ...look.root, rootId: base.root.rootId }
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

      let finalOutcome = deriveOutcome(platformResult.steps, options.expect, successor.outline)
      const diff = buildDiff(base.outline, successor.outline)

      // Optional postcondition check adjusts outcome.
      if (options.expect) {
        const binding = bindCondition(options.expect, base.outline)
        const ok = evaluateBoundCondition(binding, successor.outline)
        if (ok && finalOutcome === 'unknown') finalOutcome = 'worked'
        if (!ok && finalOutcome === 'worked') finalOutcome = 'didnt'
      }

      // Heuristic: typed/set text appears in successor outline → worked.
      if (finalOutcome === 'unknown') {
        for (const a of actions) {
          if ((a.type === 'typeText' || a.type === 'setText') && a.text) {
            if (outlineContainsText(successor.outline, a.text)) {
              finalOutcome = 'worked'
              break
            }
          }
        }
      }

      // Heuristic: step-level before/after confirms setText.
      if (finalOutcome === 'unknown') {
        const confirmed = platformResult.steps.some(
          (s) => s.applied && !s.unknown && !s.confirmedNoEffect,
        )
        if (confirmed) finalOutcome = 'worked'
      }

      return {
        outcome: finalOutcome,
        evidence,
        grounding: delivery,
        stoppedAt: platformResult.stoppedAt,
        successorStateId,
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
      return { status: 'preexisting', successorStateId: obs.stateId }
    }

    const interval = 50
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / interval))
    for (let i = 0; i < maxAttempts; i++) {
      if (this.fake) this.fake.advanceTime(interval)
      else await sleep(interval)

      const obs = await this.observe(base.root.rootId, base.mode, base.capture)
      const state = this.requireState(obs.stateId)
      if (evaluateBoundCondition(binding, state.outline)) {
        return { status: 'verified', successorStateId: obs.stateId }
      }
    }

    const last = await this.observe(base.root.rootId, base.mode, base.capture)
    return { status: 'failed', successorStateId: last.stateId }
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

  private resolveRoot(rootId?: string): UiRootIdentity {
    if (rootId) {
      const r = this.roots.get(rootId)
      if (!r) {
        throw new ComputerUseError('UNKNOWN_ROOT', `Unknown root ${rootId}`, { rootId })
      }
      return r
    }
    const list = this.roots.list()
    const focused = list.find((r) => r.focused) ?? list[0]
    if (!focused) {
      throw new ComputerUseError('UNKNOWN_ROOT', 'No UI roots available')
    }
    return focused
  }
}

function uniqueApps(
  roots: Array<Omit<UiRootIdentity, 'rootId'> | UiRootIdentity>,
): AppsSnapshot['running'] {
  const map = new Map<string, AppsSnapshot['running'][number]>()
  for (const r of roots) {
    if (!map.has(r.bundleId)) {
      map.set(r.bundleId, {
        app: r.app,
        bundleId: r.bundleId,
        pid: r.pid,
        frontmost: r.focused,
      })
    } else if (r.focused) {
      map.get(r.bundleId)!.frontmost = true
    }
  }
  return [...map.values()]
}

function deriveOutcome(
  steps: Array<{ applied: boolean; confirmedNoEffect?: boolean; unknown?: boolean }>,
  _expect: Condition | undefined,
  _outline: import('./types').UiOutlineNode,
): ActionOutcome {
  if (steps.length === 0) return 'didnt'
  // Any hard failure → didnt (even if other steps claimed unknown).
  if (steps.some((s) => s.confirmedNoEffect || !s.applied)) {
    if (steps.every((s) => !s.applied || s.confirmedNoEffect)) return 'didnt'
  }
  if (steps.some((s) => s.unknown)) return 'unknown'
  if (steps.every((s) => s.applied && !s.confirmedNoEffect)) return 'worked'
  if (steps.some((s) => s.confirmedNoEffect || !s.applied)) return 'didnt'
  return 'unknown'
}

function outlineContainsText(outline: import('./types').UiOutlineNode, text: string): boolean {
  if (!text) return false
  const stack = [outline]
  while (stack.length) {
    const n = stack.pop()!
    if ((n.name ?? '').includes(text) || (n.value ?? '').includes(text)) return true
    if (n.children) stack.push(...n.children)
  }
  return false
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
