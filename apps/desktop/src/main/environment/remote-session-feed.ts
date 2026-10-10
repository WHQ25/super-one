import type { EnvironmentEventEnvelope } from '@superone/shared/environment'

export interface RemoteSessionFeedSource {
  /** The node's durable head now. */
  head(): Promise<string>
  subscribe(afterSequence: string, signal: AbortSignal): AsyncIterable<EnvironmentEventEnvelope>
}

export interface RemoteSessionListener {
  event(envelope: EnvironmentEventEnvelope): void
  /** The feed stopped for good (the connection will not come back). */
  end(err: Error): void
}

interface Follower {
  listener: RemoteSessionListener
  /** The node's head when the follower joined; null until read, while its events wait in `held`. */
  from: bigint | null
  held: EnvironmentEventEnvelope[]
}

/**
 * One pushed event stream per connected node, shared by everything on this
 * desktop that follows a session there (chat, phones, collaboration). Each
 * follower gets the session's events committed after it joined, so a caller
 * that awaits `follow` before sending sees every event its send causes and
 * none from before, however far behind the node's head the shared stream is.
 */
export class RemoteSessionFeed {
  private readonly followers = new Map<string, Set<Follower>>()
  /** Called with every session event, of any session. */
  private readonly observers = new Set<(envelope: EnvironmentEventEnvelope) => void>()
  private readonly abort = new AbortController()
  private started: Promise<void> | null = null
  private failure: Error | null = null

  constructor(private readonly source: RemoteSessionFeedSource) {}

  async follow(sessionId: string, listener: RemoteSessionListener): Promise<() => void> {
    if (this.failure) throw this.failure
    let set = this.followers.get(sessionId)
    if (!set) this.followers.set(sessionId, set = new Set())
    // Joined before the head is read: an event committed in between is held, not lost.
    const follower: Follower = { listener, from: null, held: [] }
    set.add(follower)
    const unfollow = () => {
      set!.delete(follower)
      if (set!.size === 0 && this.followers.get(sessionId) === set) this.followers.delete(sessionId)
    }
    try {
      await this.start()
      follower.from = BigInt(await this.source.head())
    } catch (err) {
      unfollow()
      throw err
    }
    for (const envelope of follower.held.splice(0)) this.deliver(follower, envelope)
    return unfollow
  }

  /** Calls `observer` with every session event the stream reads, until the feed ends. */
  async observe(observer: (envelope: EnvironmentEventEnvelope) => void): Promise<() => void> {
    if (this.failure) throw this.failure
    this.observers.add(observer)
    const unobserve = () => { this.observers.delete(observer) }
    try {
      await this.start()
    } catch (err) {
      unobserve()
      throw err
    }
    return unobserve
  }

  close(): void {
    this.abort.abort('closed')
    this.followers.clear()
    this.observers.clear()
  }

  private start(): Promise<void> {
    this.started ??= this.source.head().then((head) => { void this.run(head) })
    // A failed head read must not poison later follows.
    this.started.catch(() => { this.started = null })
    return this.started
  }

  private deliver(follower: Follower, envelope: EnvironmentEventEnvelope): void {
    if (follower.from === null) follower.held.push(envelope)
    else if (BigInt(envelope.sequence) > follower.from) follower.listener.event(envelope)
  }

  private async run(after: string): Promise<void> {
    try {
      for await (const envelope of this.source.subscribe(after, this.abort.signal)) {
        if (envelope.aggregateType !== 'session') continue
        for (const observer of [...this.observers]) observer(envelope)
        for (const follower of [...(this.followers.get(envelope.aggregateId) ?? [])]) this.deliver(follower, envelope)
      }
    } catch (err) {
      this.failure = err instanceof Error ? err : new Error(String(err))
      const followers = [...this.followers.values()].flatMap((set) => [...set])
      this.followers.clear()
      this.observers.clear()
      for (const follower of followers) follower.listener.end(this.failure)
    }
  }
}
