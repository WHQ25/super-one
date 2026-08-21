import type { DeviceOrientation, DeviceUiNode } from '@superone/shared/device-agent'
import { fingerprintTree } from '../ios-simulator/a11y-tree'
import {
  encodeObservationFingerprint,
  observationFingerprintsMatch,
} from '../ios-simulator/observation-fingerprint'
import {
  describeCondition,
  evaluateCondition,
  matchNode,
  parseCondition,
} from './conditions'
import { judgeOutcome } from './outcome'
import { renderNode, renderTree } from './render'
import { centerOf, DeviceStateStore, findByRef } from './state-store'
import {
  DeviceAgentError,
  throwIfDeviceOperationAborted,
  waitForDeviceDelay,
  type DeviceHardwareButton,
  type DeviceObservation,
  type ResolvedAction,
  type TouchDeviceBackend,
} from './types'

/**
 * What "this screen" means when deciding whether an action did anything.
 *
 * Both readings are used, because each misses what the other catches: the tree does
 * not see a crossfade or a progress bar, and an 8x8 pixel hash does not see a label
 * swap. Missing a change is the expensive direction -- it turns a working action into
 * `unknown` and sends the agent into a retry loop against a device that already did
 * what was asked.
 */
function observationDigest(observation: DeviceObservation): string {
  // A tree recovered from pixels is excluded on purpose. OCR re-segments between
  // captures -- "Sign In" comes back as one line or as two, a glyph flips confidence
  // -- so comparing those trees reports a change on a screen nobody touched. On
  // those screens the hash is the honest signal, and it is always present, because
  // reading text and hashing pixels come from the same framebuffer.
  const treeDigest = observation.root.source === 'ocr'
    ? null
    : fingerprintTree(observation.root)
  return encodeObservationFingerprint(treeDigest, observation.frameHash)
}

export interface DeviceToolReply {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function reply(value: unknown): DeviceToolReply {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }
}

function errorReply(error: unknown): DeviceToolReply {
  const message = error instanceof DeviceAgentError
    ? `[Error] ${error.code}: ${error.message}`
    : `[Error] ${error instanceof Error ? error.message : String(error)}`
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Tell the agent when it is looking at a screen recovered from pixels.
 *
 * Not inferable from the tree itself -- OCR nodes render like any other -- and the
 * differences change what the agent should do next, so it is stated rather than left
 * to be discovered by a `press` that fails.
 */
function sourceNote(root: DeviceUiNode): Record<string, unknown> {
  if (root.source !== 'ocr') return {}
  return {
    source: 'ocr',
    note: 'This app exposes no accessibility tree, so these elements were read from the '
      + 'pixels. They can be tapped but not pressed, they have no identifier, role or '
      + 'enabled/focused state, and any control without visible text — a back chevron, a '
      + 'hamburger, a heart — does not appear at all. Match on label, and aim at bounds.',
  }
}

/** How far a swipe travels when the caller does not say. */
const DEFAULT_SWIPE_DISTANCE = 0.6

/**
 * Refuse a batch that aims at the snapshot after it has already been invalidated.
 *
 * `rotate` is the one action that ends the snapshot it is part of: the guest
 * relayouts, and confirming the turn re-reads the accessibility tree, which renumbers
 * every element the helper had handed out. So a `press` later in the same batch
 * addresses a uid that no longer exists, and a tap at coordinates chosen from the
 * pre-rotation screen lands on whatever turned into that spot.
 *
 * Caught here rather than left to fail at the device, because device_act promises the
 * whole batch is validated before anything runs. Failing mid-batch surfaces the
 * helper's own "snapshot N is stale" text as `failure`, which reads as a device fault
 * rather than a call the agent should have split in two.
 */
function assertBatchOrder(actions: ReadonlyArray<Record<string, unknown>>): void {
  const rotateAt = actions.findIndex((action) => action.type === 'rotate')
  if (rotateAt < 0) return
  const offender = actions.findIndex((action, index) => index > rotateAt && aimsAtSnapshot(action))
  if (offender < 0) return
  throw new DeviceAgentError(
    'INVALID_ACTION',
    `Action ${offender + 1} (${String(actions[offender]?.type)}) targets this snapshot, but the `
      + `rotate at action ${rotateAt + 1} invalidates it — the screen relayouts and the `
      + 'accessibility elements are rebuilt, so refs and coordinates stop naming what they named. '
      + 'End the batch with the rotate, then take a fresh device_snapshot.',
  )
}

/** Does this action read a ref or a position from the snapshot it was written against? */
function aimsAtSnapshot(action: Record<string, unknown>): boolean {
  return typeof action.ref === 'string'
    || typeof action.x === 'number'
    || typeof action.y === 'number'
}

export class DeviceAgentSession {
  readonly store = new DeviceStateStore()

  constructor(private readonly backend: TouchDeviceBackend) {}

  /**
   * Every public method funnels failures through here rather than throwing.
   *
   * A tool that throws surfaces as a harness-level error the agent cannot read or
   * act on; converting at the point of failure means the agent is told which ref
   * was unknown or which snapshot went stale, whoever called us.
   */
  private async guard(
    run: () => Promise<DeviceToolReply> | DeviceToolReply,
    signal?: AbortSignal,
  ): Promise<DeviceToolReply> {
    try {
      return await run()
    } catch (error) {
      if (signal?.aborted) {
        return errorReply(new DeviceAgentError('ABORTED', 'The device operation was cancelled.'))
      }
      return errorReply(error)
    }
  }

  snapshot(args: { mode?: string; maxNodes?: number }, signal?: AbortSignal): Promise<DeviceToolReply> {
    return this.guard(() => this.runSnapshot(args, signal), signal)
  }

  query(args: { stateId: string; op: string; text?: string; ref?: string }): Promise<DeviceToolReply> {
    return this.guard(() => this.runQuery(args))
  }

  act(args: {
    stateId: string
    actions: Array<Record<string, unknown>>
    expect?: unknown
  }, signal?: AbortSignal): Promise<DeviceToolReply> {
    return this.guard(() => this.runAct(args, signal), signal)
  }

  waitFor(
    args: { condition: unknown; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<DeviceToolReply> {
    return this.guard(() => this.runWaitFor(args, signal), signal)
  }

  private async runSnapshot(
    args: { mode?: string; maxNodes?: number },
    signal?: AbortSignal,
  ): Promise<DeviceToolReply> {
    throwIfDeviceOperationAborted(signal)
    const mode = args.mode ?? 'semantic'
    const observation = await this.backend.observe({
      ...(args.maxNodes ? { maxNodes: args.maxNodes } : {}),
      ...(signal ? { signal } : {}),
    })
    // Recorded before the screenshot, not after. The device has already been read by
    // the time observe() returns, so a failure between here and the reply must not
    // leave the store naming an older snapshot as current -- that is what lets
    // device_act accept refs the device has since renumbered.
    const state = this.store.put(observation)
    throwIfDeviceOperationAborted(signal)
    const image = mode === 'visual' || mode === 'fused' ? await this.backend.capture() : undefined
    if (image) this.store.attachImage(state.stateId, image)
    throwIfDeviceOperationAborted(signal)

    return reply({
      stateId: state.stateId,
      device: this.backend.label,
      orientation: observation.orientation,
      screen: observation.screen,
      settled: observation.settled,
      ...(observation.truncated ? { truncated: true } : {}),
      ...sourceNote(observation.root),
      ...(image ? { image } : {}),
      // Omitted in visual mode so a caller that asked for pixels does not also pay
      // for a tree it said it did not want.
      ...(mode === 'visual' ? {} : { tree: renderTree(observation.root) }),
    })
  }

  private runQuery(args: { stateId: string; op: string; text?: string; ref?: string }): DeviceToolReply {
    const state = this.store.read(args.stateId)
    const root = state.observation.root

    if (args.op === 'inspect') {
      if (!args.ref) throw new DeviceAgentError('INVALID_ACTION', 'inspect needs a ref.')
      const node = findByRef(root, args.ref)
      return reply({ stateId: state.stateId, node: renderTree(node, { maxDepth: 2 }) })
    }

    const needle = (args.text ?? '').toLowerCase()
    if (!needle) throw new DeviceAgentError('INVALID_ACTION', 'search needs text.')
    const hits: string[] = []
    const walk = (node: DeviceUiNode) => {
      const haystack = [node.label, node.value, node.identifier].filter(Boolean).join(' ').toLowerCase()
      if (haystack.includes(needle)) hits.push(renderNode(node))
      for (const child of node.children ?? []) walk(child)
    }
    walk(root)
    return reply({
      stateId: state.stateId,
      matches: hits.length,
      results: hits.slice(0, 40),
      ...(hits.length > 40 ? { note: 'Showing the first 40 matches; narrow the text to see the rest.' } : {}),
    })
  }

  private async runAct(args: {
    stateId: string
    actions: Array<Record<string, unknown>>
    expect?: unknown
  }, signal?: AbortSignal): Promise<DeviceToolReply> {
    // Checked before any effect: acting on a superseded snapshot is how an agent
    // taps a control that has already moved and then reports success.
    const state = this.store.requireCurrent(args.stateId)
    const before = observationDigest(state.observation)
    // Everything the batch can be rejected for is checked here, before the first
    // action runs -- resolution, batch ordering, and the postcondition. device_act
    // promises the whole batch is validated up front, and a rejection that surfaces
    // halfway through reads to the agent as a device failure rather than a bad call.
    const expect = args.expect === undefined ? undefined : parseCondition(args.expect)
    assertBatchOrder(args.actions)
    const actions = args.actions.map((raw) => this.resolve(state.observation.root, raw))
    throwIfDeviceOperationAborted(signal)

    let applied = true
    let failure: string | undefined
    try {
      for (const action of actions) {
        throwIfDeviceOperationAborted(signal)
        await this.backend.perform(action, {
          observation: state.observation,
          ...(signal ? { signal } : {}),
        })
      }
    } catch (error) {
      throwIfDeviceOperationAborted(signal)
      applied = false
      failure = error instanceof Error ? error.message : String(error)
    }

    const after = await this.backend.observe({ ...(signal ? { signal } : {}) })
    const nextState = this.store.put(after)
    throwIfDeviceOperationAborted(signal)
    const expectMet = expect ? evaluateCondition(after.root, expect) : undefined
    const judgement = judgeOutcome({
      applied,
      changed: !observationFingerprintsMatch(observationDigest(after), before),
      ...(expectMet === undefined ? {} : { expectMet }),
    })

    return reply({
      outcome: judgement.outcome,
      reason: judgement.reason,
      ...(failure ? { failure } : {}),
      ...(expect ? { expect: describeCondition(expect), expectMet } : {}),
      stateId: nextState.stateId,
      settled: after.settled,
      orientation: after.orientation,
      ...sourceNote(after.root),
      tree: renderTree(after.root),
    })
  }

  private async runWaitFor(
    args: { condition: unknown; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<DeviceToolReply> {
    const condition = parseCondition(args.condition)
    const timeoutMs = args.timeoutMs ?? 5000
    const deadline = Date.now() + timeoutMs
    let first = true
    let observation = await this.backend.observe({ immediate: true, ...(signal ? { signal } : {}) })
    // Every observation is committed the moment it exists, for the same reason as in
    // runSnapshot: a poll that read the device and was then cancelled must not leave
    // the store naming a snapshot the device has already moved past.
    let state = this.store.put(observation)

    while (true) {
      throwIfDeviceOperationAborted(signal)
      if (evaluateCondition(observation.root, condition)) {
        // Polls are intentionally immediate. Before returning a usable state/ref
        // pair, take one settled observation and verify the condition still holds.
        const stable = await this.backend.observe({
          settleTimeoutMs: Math.max(deadline - Date.now(), 0),
          ...(signal ? { signal } : {}),
        })
        observation = stable
        state = this.store.put(stable)
        throwIfDeviceOperationAborted(signal)
        if (!evaluateCondition(stable.root, condition)) {
          first = false
          continue
        }
        // Preexisting vs verified is the difference between a real transition and a
        // check that was never going to fail — an agent that cannot tell them apart
        // will happily "confirm" a screen it never waited for.
        return reply({
          status: first ? 'preexisting' : 'verified',
          condition: describeCondition(condition),
          stateId: state.stateId,
          waitedMs: timeoutMs - Math.max(deadline - Date.now(), 0),
          settled: stable.settled,
          orientation: stable.orientation,
          screen: stable.screen,
          ...(stable.truncated ? { truncated: true } : {}),
          ...sourceNote(stable.root),
          tree: renderTree(stable.root),
        })
      }
      first = false
      if (Date.now() >= deadline) {
        return reply({
          status: 'timeout',
          condition: describeCondition(condition),
          stateId: state.stateId,
          waitedMs: timeoutMs,
          hint: 'The condition never held. Take a device_snapshot to see what is actually on screen.',
          settled: observation.settled,
          orientation: observation.orientation,
          screen: observation.screen,
          ...(observation.truncated ? { truncated: true } : {}),
          ...sourceNote(observation.root),
          tree: renderTree(observation.root),
        })
      }
      await waitForDeviceDelay(Math.min(200, Math.max(deadline - Date.now(), 0)), signal)
      observation = await this.backend.observe({ immediate: true, ...(signal ? { signal } : {}) })
      state = this.store.put(observation)
    }
  }

  /** Turn one tool-level action into coordinates or a ref the backend can take. */
  private resolve(root: DeviceUiNode, raw: Record<string, unknown>): ResolvedAction {
    const type = String(raw.type)
    const durationMs = typeof raw.durationMs === 'number' ? raw.durationMs : undefined

    const point = (): { x: number; y: number } => {
      if (typeof raw.ref === 'string') return centerOf(findByRef(root, raw.ref))
      if (typeof raw.x === 'number' && typeof raw.y === 'number') return { x: raw.x, y: raw.y }
      throw new DeviceAgentError('INVALID_ACTION', `${type} needs a ref, or both x and y.`)
    }

    switch (type) {
      case 'tap': return { kind: 'tap', ...point() }
      case 'doubleTap': return { kind: 'doubleTap', ...point() }
      case 'longPress':
        return { kind: 'longPress', ...point(), ...(durationMs ? { durationMs } : {}) }
      case 'swipe': {
        // Centre of the screen unless aimed, because the common case is scrolling
        // the page rather than dragging one particular control.
        const from = raw.ref || (typeof raw.x === 'number' && typeof raw.y === 'number')
          ? point()
          : { x: 0.5, y: 0.5 }
        const distance = typeof raw.distance === 'number' ? raw.distance : DEFAULT_SWIPE_DISTANCE
        let toX = typeof raw.toX === 'number' ? raw.toX : undefined
        let toY = typeof raw.toY === 'number' ? raw.toY : undefined
        if (toX === undefined || toY === undefined) {
          const direction = raw.direction
          if (typeof direction !== 'string') {
            throw new DeviceAgentError('INVALID_ACTION', 'swipe needs a direction, or both toX and toY.')
          }
          const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction]
          if (!delta) throw new DeviceAgentError('INVALID_ACTION', `Unknown swipe direction ${direction}.`)
          toX = from.x + delta[0]! * distance
          toY = from.y + delta[1]! * distance
        }
        return {
          kind: 'swipe',
          fromX: from.x, fromY: from.y, toX, toY,
          ...(durationMs ? { durationMs } : {}),
        }
      }
      case 'pinch': {
        if (typeof raw.scale !== 'number') {
          throw new DeviceAgentError('INVALID_ACTION', 'pinch needs a scale.')
        }
        const at = raw.ref || (typeof raw.x === 'number' && typeof raw.y === 'number')
          ? point()
          : { x: 0.5, y: 0.5 }
        return { kind: 'pinch', ...at, scale: raw.scale, ...(durationMs ? { durationMs } : {}) }
      }
      case 'press': {
        if (typeof raw.ref !== 'string') {
          throw new DeviceAgentError('INVALID_ACTION', 'press needs a ref — it addresses the control, not a position.')
        }
        // Verified against this snapshot so an unknown ref fails here, before the
        // rest of the batch has already run.
        findByRef(root, raw.ref)
        return { kind: 'press', ref: raw.ref }
      }
      case 'type': {
        if (typeof raw.text !== 'string') throw new DeviceAgentError('INVALID_ACTION', 'type needs text.')
        return { kind: 'type', text: raw.text }
      }
      case 'key': {
        if (typeof raw.button !== 'string') throw new DeviceAgentError('INVALID_ACTION', 'key needs a button.')
        return { kind: 'key', button: raw.button as DeviceHardwareButton }
      }
      case 'rotate': {
        if (typeof raw.orientation !== 'string') {
          throw new DeviceAgentError('INVALID_ACTION', 'rotate needs an orientation.')
        }
        return { kind: 'rotate', orientation: raw.orientation as DeviceOrientation }
      }
      case 'keyboard': {
        if (typeof raw.connected !== 'boolean') {
          throw new DeviceAgentError('INVALID_ACTION', 'keyboard needs connected.')
        }
        return { kind: 'keyboard', connected: raw.connected }
      }
      default:
        throw new DeviceAgentError('INVALID_ACTION', `Unknown action ${type}.`)
    }
  }
}

export { errorReply, matchNode }
