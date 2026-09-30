let nextGeneration = 0

export interface McpAppDocument {
  readonly generation: number
  readonly active: boolean
  accepts(generation: number): boolean
  /** Wire every iframe load here. A second load permanently revokes this instance. */
  loaded(): boolean
  /** Desktop must also revoke at native navigation-start, before a request is sent. */
  revoke(): void
  onRevoke(listener: () => void): () => void
}

export function createMcpAppDocument(): McpAppDocument {
  const generation = ++nextGeneration
  let active = true
  let loads = 0
  const listeners = new Set<() => void>()
  const revoke = (): void => {
    if (!active) return
    active = false
    for (const listener of listeners) listener()
    listeners.clear()
  }
  return {
    generation,
    get active() { return active },
    accepts: value => active && value === generation,
    loaded() { if (++loads > 1) revoke(); return active },
    revoke,
    onRevoke(listener) {
      if (!active) listener()
      else listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
