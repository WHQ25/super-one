import {
  DEFAULT_STATE_LIMIT,
  type ComputerUseState,
} from './types'

/**
 * Insertion-ordered bounded store of immutable observations.
 * Evicts oldest entries when capacity is exceeded. Evicted states become
 * unreadable for mutation; query of unknown ids fails cleanly.
 */
export class StateStore {
  private readonly states = new Map<string, ComputerUseState>()
  private readonly order: string[] = []
  private readonly limit: number

  constructor(limit: number = DEFAULT_STATE_LIMIT) {
    if (limit < 1) throw new Error('StateStore limit must be >= 1')
    this.limit = limit
  }

  get size(): number {
    return this.states.size
  }

  get capacity(): number {
    return this.limit
  }

  has(stateId: string): boolean {
    return this.states.has(stateId)
  }

  get(stateId: string): ComputerUseState | undefined {
    return this.states.get(stateId)
  }

  /** Insert an immutable state. Does not mutate existing records. */
  put(state: ComputerUseState): void {
    if (this.states.has(state.stateId)) {
      throw new Error(`StateStore: duplicate stateId ${state.stateId}`)
    }
    this.states.set(state.stateId, state)
    this.order.push(state.stateId)
    while (this.order.length > this.limit) {
      const oldest = this.order.shift()
      if (oldest) this.states.delete(oldest)
    }
  }

  /** Snapshot of retained state ids in insertion order (oldest first). */
  ids(): string[] {
    return [...this.order]
  }

  clear(): void {
    this.states.clear()
    this.order.length = 0
  }
}
