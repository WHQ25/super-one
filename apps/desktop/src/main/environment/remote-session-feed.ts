import type { EnvironmentEventEnvelope } from '@superone/shared/environment'

export interface RemoteSessionFeedSource {
  /** The node's durable head now: the feed reads every event after it. */
  head(): Promise<string>
  subscribe(afterSequence: string, signal: AbortSignal): AsyncIterable<EnvironmentEventEnvelope>
}

export interface RemoteSessionListener {
  event(envelope: EnvironmentEventEnvelope): void
  /** The feed stopped for good (the connection will not come back). */
  end(err: Error): void
}

/**
 * One pushed event stream per connected node, shared by everything on this
 * desktop that follows a session there (chat, phones, collaboration). It
 * starts at the node's head when the first session is followed, so a caller
 * that awaits `follow` before sending sees every event its send causes.
 */
export class RemoteSessionFeed {
  private readonly listeners = new Map<string, Set<RemoteSessionListener>>()
  private readonly abort = new AbortController()
  private started: Promise<void> | null = null
  private failure: Error | null = null

  constructor(private readonly source: RemoteSessionFeedSource) {}

  async follow(sessionId: string, listener: RemoteSessionListener): Promise<() => void> {
    if (this.failure) throw this.failure
    let set = this.listeners.get(sessionId)
    if (!set) this.listeners.set(sessionId, set = new Set())
    set.add(listener)
    const unfollow = () => {
      set!.delete(listener)
      if (set!.size === 0 && this.listeners.get(sessionId) === set) this.listeners.delete(sessionId)
    }
    try {
      await this.start()
    } catch (err) {
      unfollow()
      throw err
    }
    return unfollow
  }

  close(): void {
    this.abort.abort('closed')
    this.listeners.clear()
  }

  private start(): Promise<void> {
    this.started ??= this.source.head().then((head) => { void this.run(head) })
    // A failed head read must not poison later follows.
    this.started.catch(() => { this.started = null })
    return this.started
  }

  private async run(after: string): Promise<void> {
    try {
      for await (const envelope of this.source.subscribe(after, this.abort.signal)) {
        if (envelope.aggregateType !== 'session') continue
        for (const listener of [...(this.listeners.get(envelope.aggregateId) ?? [])]) listener.event(envelope)
      }
    } catch (err) {
      this.failure = err instanceof Error ? err : new Error(String(err))
      const listeners = [...this.listeners.values()].flatMap((set) => [...set])
      this.listeners.clear()
      for (const listener of listeners) listener.end(this.failure)
    }
  }
}
