interface Deadline {
  remainingMs: number
  deadlineAt: number
  timer?: ReturnType<typeof setTimeout>
  expire: () => void
}

/** Connection-local timeout budgets exclude overlapping user-input waits once. */
export class CodexUserInputBudget {
  private readonly waits = new Set<string | number>()
  private readonly deadlines = new Set<Deadline>()
  private startedAt: number | undefined
  private elapsedMs = 0

  begin(id: string | number): void {
    if (!this.waits.size) {
      this.startedAt = Date.now()
      for (const deadline of this.deadlines) {
        clearTimeout(deadline.timer)
        deadline.timer = undefined
        deadline.remainingMs = Math.max(0, deadline.deadlineAt - Date.now())
      }
    }
    this.waits.add(id)
  }

  end(id: string | number): void {
    this.waits.delete(id)
    if (!this.waits.size && this.startedAt !== undefined) {
      this.elapsedMs += Math.max(0, Date.now() - this.startedAt)
      this.startedAt = undefined
      for (const deadline of this.deadlines) this.arm(deadline)
    }
  }

  getWaitMs(): number {
    return this.elapsedMs + (this.startedAt === undefined ? 0 : Math.max(0, Date.now() - this.startedAt))
  }

  deadline(timeoutMs: number, expire: () => void): () => void {
    const deadline: Deadline = { remainingMs: timeoutMs, deadlineAt: Date.now() + timeoutMs, expire }
    this.deadlines.add(deadline)
    this.arm(deadline)
    return () => { clearTimeout(deadline.timer); this.deadlines.delete(deadline) }
  }

  private arm(deadline: Deadline): void {
    if (this.waits.size) return
    deadline.deadlineAt = Date.now() + deadline.remainingMs
    deadline.timer = setTimeout(() => { this.deadlines.delete(deadline); deadline.expire() }, deadline.remainingMs)
  }
}
