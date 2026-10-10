import type { EnvironmentEventEnvelope, TopicInterest } from '@superone/shared/environment'
import { SESSION_LIST_EVENT_TYPES, type TopicRef } from '@superone/shared/environment/topics'

export interface RemoteSessionFeedSource {
  /** The node's durable head now: the stream starts after it. */
  head(): Promise<string>
  subscribe(
    afterSequence: string,
    signal: AbortSignal,
    handlers: {
      /** The topics the stream follows, as they change. */
      interest: TopicInterest
      onResnapshot: (sessionIds: string[]) => void
      /** The stream came back on a link of another tier. */
      onRealign: () => void
    },
  ): AsyncIterable<EnvironmentEventEnvelope>
}

export interface RemoteSessionListener {
  event(envelope: EnvironmentEventEnvelope): void
  /** The feed stopped for good (the connection will not come back). */
  end(err: Error): void
  /** Read the session's snapshot again: some of its events are gone, or the link changed tier. */
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
 * desktop that follows a session there (chat, routed phones, collaboration)
 * or watches its session list. The stream carries only the union of their
 * interests: the `sessionList` topic while anyone observes, and each session
 * someone follows, counted per follower. A follower joins at a barrier —
 * usually the version of a snapshot it reads once the node has its topic,
 * with its events held meanwhile — and gets the session's events above it, so
 * nothing is missed or applied twice however far behind the node the shared
 * stream is.
 */
export class RemoteSessionFeed {
  private readonly followers = new Map<string, Set<Follower>>()
  /** Called with every session-list event (`SESSION_LIST_EVENT_TYPES`). */
  private readonly observers = new Set<(envelope: EnvironmentEventEnvelope) => void>()
  private readonly watchers = new Set<(topics: TopicRef[]) => Promise<void>>()
  private readonly abort = new AbortController()
  private started: Promise<void> | null = null
  private failure: Error | null = null
  private readonly interest: TopicInterest = {
    current: () => this.topics(),
    watch: (apply) => {
      this.watchers.add(apply)
      return () => { this.watchers.delete(apply) }
    },
  }

  constructor(
    private readonly source: RemoteSessionFeedSource,
    /** The node's environment id, which its topics are scoped to. */
    private readonly environmentId: string,
  ) {}

  /** Follows a session above the version `barrier` returns, read once the stream carries the session. */
  async follow(sessionId: string, listener: RemoteSessionListener, barrier: () => Promise<number>): Promise<() => void> {
    if (this.failure) throw this.failure
    let set = this.followers.get(sessionId)
    const added = !set
    if (!set) this.followers.set(sessionId, set = new Set())
    const follower: Follower = { listener, from: null, held: [] }
    set.add(follower)
    const unfollow = () => {
      set!.delete(follower)
      if (set!.size > 0 || this.followers.get(sessionId) !== set) return
      this.followers.delete(sessionId)
      void this.applyInterest()
    }
    try {
      await this.start()
      if (added) await this.applyInterest()
      follower.from = await barrier()
    } catch (err) {
      unfollow()
      throw err
    }
    for (const envelope of follower.held.splice(0)) this.deliver(follower, envelope)
    return unfollow
  }

  /** Calls `observer` with every session-list event the stream reads, until the feed ends. */
  async observe(observer: (envelope: EnvironmentEventEnvelope) => void): Promise<() => void> {
    if (this.failure) throw this.failure
    const added = this.observers.size === 0
    this.observers.add(observer)
    const unobserve = () => {
      if (this.observers.delete(observer) && this.observers.size === 0) void this.applyInterest()
    }
    try {
      await this.start()
      if (added) await this.applyInterest()
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
    this.watchers.clear()
  }

  private topics(): TopicRef[] {
    const environmentId = this.environmentId
    return [
      ...(this.observers.size > 0 ? [{ kind: 'sessionList' as const, environmentId }] : []),
      ...[...this.followers.keys()].map((sessionId) => ({ kind: 'session' as const, environmentId, sessionId })),
    ]
  }

  /**
   * Hands the current topics to the running stream and waits for the node to
   * apply them. A stream that fails meanwhile resubscribes with them from its
   * cursor, so the change is not lost.
   */
  private async applyInterest(): Promise<void> {
    const topics = this.topics()
    await Promise.all([...this.watchers].map((apply) => apply(topics).catch(() => {})))
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

  private resync(sessionIds: Iterable<string>): void {
    for (const id of sessionIds) {
      for (const follower of [...(this.followers.get(id) ?? [])]) follower.listener.resync?.()
    }
  }

  private async run(after: string): Promise<void> {
    try {
      const handlers = {
        interest: this.interest,
        onResnapshot: (ids: string[]) => this.resync(ids),
        onRealign: () => this.resync([...this.followers.keys()]),
      }
      for await (const envelope of this.source.subscribe(after, this.abort.signal, handlers)) {
        if (envelope.aggregateType !== 'session') continue
        if (SESSION_LIST_EVENT_TYPES.has(envelope.eventType)) {
          for (const observer of [...this.observers]) observer(envelope)
        }
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
