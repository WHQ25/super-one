import type { DeviceUiNode } from '@superone/shared/device-agent'
import { DeviceAgentError, type DeviceImage, type DeviceObservation } from './types'

/**
 * Snapshots an agent can quote back.
 *
 * The point of handing out a `stateId` is not caching — it is refusing to act on a
 * screen that has moved on. Refs like `@e12` are positional, so after a transition
 * the same ref names a different control; acting on a stale snapshot is how an agent
 * silently taps the wrong thing and then reports success. Quoting the id makes that
 * a rejection instead.
 */
export interface DeviceState {
  stateId: string
  observation: DeviceObservation
  image?: DeviceImage
  createdAt: number
}

/** Older snapshots stay readable so `device_query` can revisit one without recapturing. */
const RETAINED_STATES = 8

export class DeviceStateStore {
  private readonly states = new Map<string, DeviceState>()
  private counter = 0
  private latestId: string | null = null

  put(observation: DeviceObservation, image?: DeviceImage): DeviceState {
    const state: DeviceState = {
      stateId: `s${++this.counter}`,
      observation,
      createdAt: Date.now(),
      ...(image ? { image } : {}),
    }
    this.states.set(state.stateId, state)
    this.latestId = state.stateId
    for (const key of [...this.states.keys()].slice(0, -RETAINED_STATES)) this.states.delete(key)
    return state
  }

  /**
   * Attach the screenshot to a snapshot already on record.
   *
   * Separate from `put` because the observation has to be recorded the instant it
   * exists: the device has moved by then, and a screenshot that fails afterwards
   * must not leave an older snapshot standing as the current one.
   */
  attachImage(stateId: string, image: DeviceImage): void {
    const state = this.states.get(stateId)
    if (state) state.image = image
  }

  get latest(): DeviceState | undefined {
    return this.latestId ? this.states.get(this.latestId) : undefined
  }

  /** Readable even when superseded — queries are side-effect free. */
  read(stateId: string): DeviceState {
    const state = this.states.get(stateId)
    if (!state) {
      throw new DeviceAgentError(
        'STALE_STATE',
        `Snapshot ${stateId} is no longer available. Take a fresh device_snapshot.`,
      )
    }
    return state
  }

  /**
   * The stricter lookup used before anything with an effect: a superseded snapshot
   * is refused rather than acted on.
   */
  requireCurrent(stateId: string): DeviceState {
    const state = this.read(stateId)
    if (state.stateId !== this.latestId) {
      throw new DeviceAgentError(
        'STALE_STATE',
        `Snapshot ${stateId} has been superseded by ${this.latestId}. `
          + 'Take a fresh device_snapshot before acting — refs from an old snapshot may now name different controls.',
      )
    }
    return state
  }

  clear(): void {
    this.states.clear()
    this.latestId = null
  }
}

export function findByRef(root: DeviceUiNode, ref: string): DeviceUiNode {
  const stack: DeviceUiNode[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.ref === ref) return node
    for (const child of node.children ?? []) stack.push(child)
  }
  throw new DeviceAgentError('UNKNOWN_REF', `${ref} is not in this snapshot.`)
}

/**
 * Where to touch to hit a node.
 *
 * Its centre, in framebuffer ratios — the same space touch input speaks, so no
 * further conversion happens at the point of use.
 */
export function centerOf(node: DeviceUiNode): { x: number; y: number } {
  if (!node.bounds) {
    throw new DeviceAgentError(
      'INVALID_ACTION',
      `${node.ref} has no on-screen bounds, so it cannot be touched. `
        + 'Use action "press" to drive it through accessibility instead.',
    )
  }
  const [x, y, width, height] = node.bounds
  return { x: x + width / 2, y: y + height / 2 }
}
