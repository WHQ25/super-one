/** A host wake waits for input handoff, independently of the model's reply. */
export class InputAdmission {
  readonly promise: Promise<void>
  private resolve!: () => void
  private rejectPromise!: (error: unknown) => void
  private settled = false

  constructor(private readonly delivery: { onInputAccepted: () => void; beforeInput?: () => void }) {
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.rejectPromise = reject })
  }

  accept(): void {
    if (this.settled) return
    this.delivery.onInputAccepted()
    this.settled = true
    this.resolve()
  }

  beforeInput(): void { this.delivery.beforeInput?.() }

  reject(error: unknown): void {
    if (this.settled) return
    this.settled = true
    this.rejectPromise(error)
  }
}
