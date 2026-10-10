import type { EnvironmentEventEnvelope } from '@superone/shared/environment'

export interface RemoteSessionFeedSource {
  /** The node's durable head now: the stream starts after it. */
  head(): Promise<string>
  subscribe(
    afterSequence: string,
    signal: AbortSignal,
    onResnapshot: (sessionIds: string[]) => void,
  ): AsyncIterable<EnvironmentEventEnvelope>
}

export interface RemoteSessionListener {
  event(envelope: EnvironmentEventEnvelope): void
  /** The feed stopped for good (the connection will not come back). */
  end(err: Error): void
  /** Some of the session's events are gone; read its snapshot again. */
  resync?(): void
}

interface Follower {
  listener: RemoteSessionListener
  /** Version the follower starts above; null while its barrier is read, with its events held. */
  from: number | null
  held: EnvironmentEventEnvelope[]
}

/**
 * One pushed event stream per connected node, shared by everything on this
 * desktop that follows a session there (chat, phones, collaboration). A
 * follower joins at a barrier — usually the version of a snapshot it reads
 * while its events are held — and gets the session's events above it, so
 * nothing is missed or applied twice however far behind the node the shared
 * stream is.
 */
export class RemoteSessionFeed {
  private readonly followers = new Map<string, Set<Follower>>()
  /** Called with every session event, of any session. */
  private readonly observers = new Set<(envelope: EnvironmentEventEnvelope) => void>()
  private readonly abort = new AbortController()
  private started: Promise<void> | null = null
  private failure: Error | null = null

  constructor(private readonly source: RemoteSessionFeedSource) {}

  /** Follows a session above the version `barrier` returns, read after joining. */
  async follow(sessionId: string, listener: RemoteSessionListener, barrier: () => Promise<number>): Promise<() => void> {
    if (this.failure) throw this.failure
    let set = this.followers.get(sessionId)
    if (!set) this.followers.set(sessionId, set = new Set())
    const follower: Follower = { listener, from: null, held: [] }
    set.add(follower)
    const unfollow = () => {
      set!.delete(follower)
      if (set!.size === 0 && this.followers.get(sessionId) === set) this.followers.delete(sessionId)
    }
    try {
      await this.start()
      follower.from = await barrier()
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
    else if ((envelope.sessionVersion ?? Number(envelope.sequence)) > follower.from) follower.listener.event(envelope)
  }

  private resync(sessionIds: string[]): void {
    for (const id of sessionIds) {
      for (const follower of [...(this.followers.get(id) ?? [])]) follower.listener.resync?.()
    }
  }

  private async run(after: string): Promise<void> {
    try {
      for await (const envelope of this.source.subscribe(after, this.abort.signal, (ids) => this.resync(ids))) {
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
