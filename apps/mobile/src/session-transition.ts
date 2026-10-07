export class SessionTransitionBusyError extends Error {
  override name = 'SessionTransitionBusyError'
  constructor() { super('A session switch is still finishing. Please try again shortly.') }
}

/** Serializes session switches that share one transport event buffer. */
export class SessionTransition {
  private active = false

  get isActive(): boolean {
    return this.active
  }

  assertIdle(): void {
    if (this.active) throw new SessionTransitionBusyError()
  }

  run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active) return Promise.reject(new SessionTransitionBusyError())
    this.active = true
    return Promise.resolve()
      .then(action)
      .finally(() => { this.active = false })
  }
}
