interface Job { start(): void }
interface QueueState { active?: Job; waiting: Job[]; generation: AbortController }

/** One controller slot per session, shared by permissions, forms, questions and confirms. */
export class SessionInteractionQueue {
  private readonly sessions = new Map<string, QueueState>()

  run<T>(sessionId: string, signal: AbortSignal | undefined, cancelled: T, present: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let state = this.sessions.get(sessionId)
    if (!state) { state = { waiting: [], generation: new AbortController() }; this.sessions.set(sessionId, state) }
    const queue = state
    const scoped = AbortSignal.any([queue.generation.signal, ...(signal ? [signal] : [])])
    const clean = () => {
      if (!queue.active && !queue.waiting.length && this.sessions.get(sessionId) === queue) this.sessions.delete(sessionId)
    }
    const drain = () => {
      if (queue.active) return
      const next = queue.waiting.shift()
      if (next) { queue.active = next; next.start() }
      else clean()
    }
    if (scoped.aborted) { clean(); return Promise.resolve(cancelled) }
    return new Promise<T>((resolve, reject) => {
      let started = false, finished = false
      const abortQueued = () => {
        if (started || finished) return
        finished = true
        queue.waiting = queue.waiting.filter(entry => entry !== job)
        resolve(cancelled)
        clean()
      }
      const finish = () => {
        finished = true
        if (queue.active === job) queue.active = undefined
        drain()
      }
      const job: Job = { start: () => {
        if (finished) { finish(); return }
        started = true
        scoped.removeEventListener('abort', abortQueued)
        if (scoped.aborted) { resolve(cancelled); finish(); return }
        try { void present(scoped).then(resolve, reject).finally(finish) }
        catch (error) { reject(error); finish() }
      } }
      queue.waiting.push(job)
      scoped.addEventListener('abort', abortQueued, { once: true })
      drain()
    })
  }

  /** Cancel only the current generation; future requests can ask the controller again. */
  cancel(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const previous = state.generation
    state.generation = new AbortController()
    previous.abort()
  }
}
