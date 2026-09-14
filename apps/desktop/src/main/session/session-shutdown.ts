/** Share shutdown completion, including failures, with every disposal caller. */
export class SessionShutdown {
  private completion: Promise<void> | null = null

  run(dispose: () => Promise<void>): Promise<void> {
    if (!this.completion) {
      let resolve!: () => void
      let reject!: (error: unknown) => void
      // Publish completion first, but mark the session disposed synchronously.
      this.completion = new Promise<void>((done, fail) => { resolve = done; reject = fail })
      void dispose().then(resolve, reject)
    }
    return this.completion
  }
}
