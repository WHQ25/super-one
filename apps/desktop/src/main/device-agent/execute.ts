import type { DeviceOrientation, DeviceUiNode } from '@superone/shared/device-agent'
import { fingerprintTree } from '../ios-simulator/a11y-tree'
import {
  describeCondition,
  evaluateCondition,
  matchNode,
  type DeviceCondition,
} from './conditions'
import { judgeOutcome } from './outcome'
import { renderNode, renderTree } from './render'
import { centerOf, DeviceStateStore, findByRef } from './state-store'
import {
  DeviceAgentError,
  throwIfDeviceOperationAborted,
  waitForDeviceDelay,
  type DeviceHardwareButton,
  type ResolvedAction,
  type TouchDeviceBackend,
} from './types'

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

/** How far a swipe travels when the caller does not say. */
const DEFAULT_SWIPE_DISTANCE = 0.6

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
    expect?: DeviceCondition
  }, signal?: AbortSignal): Promise<DeviceToolReply> {
    return this.guard(() => this.runAct(args, signal), signal)
  }

  waitFor(
    args: { condition: DeviceCondition; timeoutMs?: number },
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
    throwIfDeviceOperationAborted(signal)
    const image = mode === 'visual' || mode === 'fused' ? await this.backend.capture() : undefined
    throwIfDeviceOperationAborted(signal)
    const state = this.store.put(observation, image)

    return reply({
      stateId: state.stateId,
      device: this.backend.label,
      orientation: observation.orientation,
      screen: observation.screen,
      settled: observation.settled,
      ...(observation.truncated ? { truncated: true } : {}),
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
    expect?: DeviceCondition
  }, signal?: AbortSignal): Promise<DeviceToolReply> {
    // Checked before any effect: acting on a superseded snapshot is how an agent
    // taps a control that has already moved and then reports success.
    const state = this.store.requireCurrent(args.stateId)
    const before = fingerprintTree(state.observation.root)
    // Resolve every target before performing the first action. This makes invalid
    // batches atomic with respect to validation instead of leaving partial effects.
    const actions = args.actions.map((raw) => this.resolve(state.observation.root, raw))
    throwIfDeviceOperationAborted(signal)

    let applied = true
    let failure: string | undefined
    try {
      for (const action of actions) {
        throwIfDeviceOperationAborted(signal)
        await this.backend.perform(action, signal)
      }
    } catch (error) {
      throwIfDeviceOperationAborted(signal)
      applied = false
      failure = error instanceof Error ? error.message : String(error)
    }

    const after = await this.backend.observe({ ...(signal ? { signal } : {}) })
    throwIfDeviceOperationAborted(signal)
    const nextState = this.store.put(after)
    const expectMet = args.expect ? evaluateCondition(after.root, args.expect) : undefined
    const judgement = judgeOutcome({
      applied,
      changed: fingerprintTree(after.root) !== before,
      ...(expectMet === undefined ? {} : { expectMet }),
    })

    return reply({
      outcome: judgement.outcome,
      reason: judgement.reason,
      ...(failure ? { failure } : {}),
      ...(args.expect ? { expect: describeCondition(args.expect), expectMet } : {}),
      stateId: nextState.stateId,
      settled: after.settled,
      orientation: after.orientation,
      tree: renderTree(after.root),
    })
  }

  private async runWaitFor(
    args: { condition: DeviceCondition; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<DeviceToolReply> {
    const timeoutMs = args.timeoutMs ?? 5000
    const deadline = Date.now() + timeoutMs
    let first = true
    let observation = await this.backend.observe({ immediate: true, ...(signal ? { signal } : {}) })

    while (true) {
      throwIfDeviceOperationAborted(signal)
      if (evaluateCondition(observation.root, args.condition)) {
        // Polls are intentionally immediate. Before returning a usable state/ref
        // pair, take one settled observation and verify the condition still holds.
        const stable = await this.backend.observe({
          settleTimeoutMs: Math.max(deadline - Date.now(), 0),
          ...(signal ? { signal } : {}),
        })
        throwIfDeviceOperationAborted(signal)
        if (!evaluateCondition(stable.root, args.condition)) {
          first = false
          observation = stable
          continue
        }
        // Preexisting vs verified is the difference between a real transition and a
        // check that was never going to fail — an agent that cannot tell them apart
        // will happily "confirm" a screen it never waited for.
        const state = this.store.put(stable)
        return reply({
          status: first ? 'preexisting' : 'verified',
          condition: describeCondition(args.condition),
          stateId: state.stateId,
          waitedMs: timeoutMs - Math.max(deadline - Date.now(), 0),
          settled: stable.settled,
          orientation: stable.orientation,
          screen: stable.screen,
          ...(stable.truncated ? { truncated: true } : {}),
          tree: renderTree(stable.root),
        })
      }
      first = false
      if (Date.now() >= deadline) {
        const state = this.store.put(observation)
        return reply({
          status: 'timeout',
          condition: describeCondition(args.condition),
          stateId: state.stateId,
          waitedMs: timeoutMs,
          hint: 'The condition never held. Take a device_snapshot to see what is actually on screen.',
          settled: observation.settled,
          orientation: observation.orientation,
          screen: observation.screen,
          ...(observation.truncated ? { truncated: true } : {}),
          tree: renderTree(observation.root),
        })
      }
      await waitForDeviceDelay(Math.min(200, Math.max(deadline - Date.now(), 0)), signal)
      observation = await this.backend.observe({ immediate: true, ...(signal ? { signal } : {}) })
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
