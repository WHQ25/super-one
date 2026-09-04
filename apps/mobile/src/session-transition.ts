/** Serializes session switches that share one transport event buffer. */
export class SessionTransition {
  private active = false

  get isActive(): boolean {
    return this.active
  }

  run(action: () => Promise<void>): Promise<void> {
    if (this.active) return Promise.resolve()
    this.active = true
    return Promise.resolve()
      .then(action)
      .finally(() => { this.active = false })
  }
}
