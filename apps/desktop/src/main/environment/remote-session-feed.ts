import type { EnvironmentEventEnvelope, SessionStreamFrame, TopicInterest, TopicNoticeFrame, TopicSubscribeInput } from '@superone/shared/environment'
import { SESSION_LIST_EVENT_TYPES, topicKey, type TopicRef } from '@superone/shared/environment/topics'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import { RemoteTopicFollowers, type RemoteTopicStream } from './remote-topic-followers'

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
      onFrame?: (frame: SessionStreamFrame) => void
      onTerminal?: RpcStreamHandlers['onTerminal']
      onDraft?: RpcStreamHandlers['onDraft']
      onTopic?: RpcStreamHandlers['onTopic']
      /** The topic update is on the wire; its ack may still be in flight. `topics` is the set that was sent. */
      onUpdateQueued?: (topics: TopicRef[]) => void
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

/**
 * What a session-list observer hears from a node. A desktop node pushes its
 * list topics as notices (every create, rename, flag, tag, removal and
 * sidebar activity, whoever made it); a CLI node's `sessionList` topic is its
 * durable list events.
 */
export interface RemoteListObserver {
  /** A durable session-list event (`SESSION_LIST_EVENT_TYPES`), from a node that pushes no list notices. */
  event?(envelope: EnvironmentEventEnvelope): void
  /** A `sessionList` or `projects` notice: change events, or a snapshot that stands in for missed ones. */
  notice?(frame: TopicNoticeFrame): void
}

const LIST_NOTICE_KINDS: ReadonlySet<string> = new Set(['sessionList', 'projects'])

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
 * interests: the `sessionList` and `projects` topics while anyone observes,
 * and each session someone follows, counted per follower. A follower joins at a barrier —
 * usually the version of a snapshot it reads once the node has its topic,
 * with its events held meanwhile — and gets the session's events above it, so
 * nothing is missed or applied twice however far behind the node the shared
 * stream is.
 */
export class RemoteSessionFeed {
  private readonly followers = new Map<string, Set<Follower>>()
  private readonly observers = new Set<RemoteListObserver>()
  /** The node pushes `sessionList` notices, which cover its durable list events. */
  private listNotices = false
  private readonly watchers = new Set<(topics: TopicRef[]) => Promise<void>>()
  private readonly abort = new AbortController()
  private started: Promise<void> | null = null
  private failure: Error | null = null
  private readonly native = new RemoteTopicFollowers(() => this.applyInterest())
  /** Follows waiting until an update that includes their session has been sent. */
  private readonly updateWaiters: Array<{ sessionId: string; release: () => void }> = []
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

  /** A native downstream joins this same upstream, with a one-shot cursor cut rather than another socket stream. */
  followTopics(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers,
    catchUp: () => Promise<SessionStreamFrame>): Promise<RemoteTopicStream> {
    if (this.failure) return Promise.reject(this.failure)
    return this.native.open(input, handlers, async () => { await this.start(); await this.applyInterest() }, catchUp)
  }

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
      void this.applyInterest().catch(() => {})
    }
    try {
      await this.start()
      if (added) await this.interestSent(sessionId)
      follower.from = await barrier()
    } catch (err) {
      unfollow()
      throw err
    }
    for (const envelope of follower.held.splice(0)) this.deliver(follower, envelope)
    return unfollow
  }

  /** Tells `observer` every session-list and project change the stream reads, until the feed ends. */
  async observe(observer: RemoteListObserver): Promise<() => void> {
    if (this.failure) throw this.failure
    const added = this.observers.size === 0
    this.observers.add(observer)
    const unobserve = () => {
      if (this.observers.delete(observer) && this.observers.size === 0) void this.applyInterest().catch(() => {})
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
    this.native.close()
  }

  private topics(): TopicRef[] {
    const environmentId = this.environmentId
    return [...new Map([
      ...(this.observers.size > 0 ? [{ kind: 'sessionList' as const, environmentId }, { kind: 'projects' as const, environmentId }] : []),
      ...[...this.followers.keys()].map((sessionId) => ({ kind: 'session' as const, environmentId, sessionId })),
      ...this.native.topics(),
    ].map(topic => [topicKey(topic), topic])).values()]
  }

  /**
   * Wait until the node has been told about this session. When the transport
   * reports the update frame is queued, the barrier overlaps its ack. A source
   * that never reports that still waits until the update has been applied, so
   * the barrier does not run before the topic was sent. An earlier update that
   * does not include this session does not count.
   */
  private async interestSent(sessionId: string): Promise<void> {
    // Register before applyInterest: the transport can report the frame queued
    // synchronously, inside that call, before its ack.
    let resolveQueued!: () => void
    const queued = new Promise<void>((resolve) => { resolveQueued = resolve })
    const waiter = { sessionId, release: () => resolveQueued() }
    this.updateWaiters.push(waiter)
    const applied = this.applyInterest()
    try {
      await Promise.race([queued, applied])
    } finally {
      const index = this.updateWaiters.indexOf(waiter)
      if (index >= 0) this.updateWaiters.splice(index, 1)
    }
    void applied.catch(() => {})
  }

  private noteUpdateQueued(topics: readonly TopicRef[]): void {
    const sent = new Set(
      topics.flatMap((topic) => (
        topic.kind === 'session' && topic.environmentId === this.environmentId ? [topic.sessionId] : []
      )),
    )
    if (sent.size === 0) return
    for (const waiter of this.updateWaiters) {
      if (sent.has(waiter.sessionId)) waiter.release()
    }
  }

  /**
   * Hands the current topics to the running stream and waits for the node to
   * apply them. A stream that fails meanwhile resubscribes with them from its
   * cursor, so the change is not lost.
   */
  private async applyInterest(): Promise<void> {
    const topics = this.topics()
    await Promise.all([...this.watchers].map((apply) => apply(topics)))
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

  private notice(frame: TopicNoticeFrame): void {
    if (frame.topic.environmentId !== this.environmentId || !LIST_NOTICE_KINDS.has(frame.topic.kind)) return
    if (frame.topic.kind === 'sessionList') this.listNotices = true
    for (const observer of [...this.observers]) observer.notice?.(frame)
  }

  private async run(after: string): Promise<void> {
    try {
      const handlers = {
        interest: this.interest,
        onResnapshot: (ids: string[]) => this.resync(ids),
        onRealign: () => { this.resync([...this.followers.keys()]); this.native.realign() },
        onFrame: (frame: SessionStreamFrame) => this.native.frame(frame),
        onTerminal: (event: Parameters<NonNullable<RpcStreamHandlers['onTerminal']>>[0]) => this.native.terminal(event),
        onDraft: (event: Parameters<NonNullable<RpcStreamHandlers['onDraft']>>[0]) => this.native.draft(event),
        onTopic: (frame: TopicNoticeFrame) => { this.notice(frame); this.native.topic(frame) },
        onUpdateQueued: (topics: TopicRef[]) => this.noteUpdateQueued(topics),
      }
      for await (const envelope of this.source.subscribe(after, this.abort.signal, handlers)) {
        if (envelope.aggregateType !== 'session') continue
        if (!this.listNotices && SESSION_LIST_EVENT_TYPES.has(envelope.eventType)) {
          for (const observer of [...this.observers]) observer.event?.(envelope)
        }
        for (const follower of [...(this.followers.get(envelope.aggregateId) ?? [])]) this.deliver(follower, envelope)
      }
    } catch (err) {
      this.failure = err instanceof Error ? err : new Error(String(err))
      const followers = [...this.followers.values()].flatMap((set) => [...set])
      this.followers.clear()
      this.observers.clear()
      this.native.close(this.failure)
      for (const follower of followers) follower.listener.end(this.failure)
    }
  }
}
