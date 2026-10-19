export class SessionTransitionSupersededError extends Error {
  override name = 'SessionTransitionSupersededError'
  constructor() { super('session transition superseded') }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * One session restore at a time: they share the client's event buffer.
 * A newer switch aborts the previous one and runs after it has released the buffer.
 */
export class SessionTransition {
  private generation = 0
  private pending: Promise<unknown> = Promise.resolve()
  private abort: AbortController | null = null

  get isActive(): boolean {
    return this.abort !== null
  }

  assertIdle(): void {
    if (this.abort) throw new SessionTransitionSupersededError()
  }

  run<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.abort?.abort()
    const controller = new AbortController()
    const generation = ++this.generation
    this.abort = controller
    const result = this.pending.catch(() => {}).then(async () => {
      if (generation !== this.generation || controller.signal.aborted) throw new SessionTransitionSupersededError()
      try {
        return await action(controller.signal)
      } finally {
        if (this.generation === generation) this.abort = null
      }
    })
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }
}
