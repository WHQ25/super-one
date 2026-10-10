import { isTopicWildcard, topicKey, topicWildcardKey, type TopicRef } from '@superone/shared/environment/topics'

/**
 * One backend's topic routing: producers publish by topic, and each frontend
 * connection receives only the topics it subscribed to, in publish order. The
 * hub knows nothing about how a connection delivers (IPC, a phone channel, a
 * node socket); that is the connection's sink and policy.
 */

/** Delivers to one connection. */
export interface TopicSink<T> {
  deliver(topic: TopicRef, item: T): void
}

/**
 * Delivers once per publish to every member connection it reaches, for
 * connections that share one transport and batch across recipients.
 */
export interface TopicGroup<T> {
  deliver(topic: TopicRef, item: T, connectionIds: readonly string[]): void
}

export interface TopicConnectionOptions<T, P> {
  /** Unique within the hub: the renderer, a phone device id, a node client session. */
  id: string
  policy: P
  sink: TopicSink<T> | { group: TopicGroup<T> }
}

type InterestListener = (topic: TopicRef, interested: boolean) => void

export interface TopicConnection<P> {
  readonly id: string
  readonly policy: P
  readonly closed: boolean
  /** Re-evaluated on failover; the next delivery uses it. */
  setPolicy(policy: P): void
  subscribe(topic: TopicRef): void
  unsubscribe(topic: TopicRef): void
  /** Makes `topics` the connection's subscriptions of `kind`. */
  replace(kind: TopicRef['kind'], topics: readonly TopicRef[]): void
  has(topic: TopicRef): boolean
  /** Whether a publish to `topic` reaches this connection (exact or wildcard). */
  receives(topic: TopicRef): boolean
  topics(): TopicRef[]
  close(): void
}

interface Entry<T, P> {
  connection: TopicConnection<P>
  sink: TopicSink<T> | { group: TopicGroup<T> }
  topics: Map<string, TopicRef>
}

export interface TopicHubOptions {
  /** A sink threw; the other connections still get the item. */
  onSinkError?: (connectionId: string, topic: TopicRef, error: unknown) => void
}

export class TopicHub<T, P = unknown> {
  private readonly connections = new Map<string, Entry<T, P>>()
  /** Topic key → connection ids subscribed, in subscription order. */
  private readonly routes = new Map<string, Set<string>>()
  private readonly interestListeners = new Set<InterestListener>()

  constructor(private readonly options: TopicHubOptions = {}) {}

  open(options: TopicConnectionOptions<T, P>): TopicConnection<P> {
    this.connections.get(options.id)?.connection.close()
    let policy = options.policy
    let closed = false
    const topics = new Map<string, TopicRef>()
    const hub = this
    const connection: TopicConnection<P> = {
      id: options.id,
      get policy() { return policy },
      get closed() { return closed },
      setPolicy(next) { policy = next },
      subscribe(topic) {
        if (closed) return
        const key = topicKey(topic)
        if (topics.has(key)) return
        topics.set(key, topic)
        hub.route(key, topic, options.id, true)
      },
      unsubscribe(topic) {
        const key = topicKey(topic)
        if (!topics.delete(key)) return
        hub.route(key, topic, options.id, false)
      },
      replace(kind, next) {
        const wanted = new Map(next.filter((topic) => topic.kind === kind).map((topic) => [topicKey(topic), topic]))
        for (const [key, topic] of [...topics]) if (topic.kind === kind && !wanted.has(key)) connection.unsubscribe(topic)
        for (const topic of wanted.values()) connection.subscribe(topic)
      },
      has: (topic) => topics.has(topicKey(topic)),
      receives(topic) {
        if (topics.has(topicKey(topic))) return true
        const wildcard = topicWildcardKey(topic)
        return wildcard !== null && topics.has(wildcard)
      },
      topics: () => [...topics.values()],
      close() {
        if (closed) return
        for (const topic of [...topics.values()]) connection.unsubscribe(topic)
        closed = true
        if (hub.connections.get(options.id)?.connection === connection) hub.connections.delete(options.id)
      },
    }
    this.connections.set(options.id, { connection, sink: options.sink, topics })
    return connection
  }

  get(id: string): TopicConnection<P> | undefined {
    return this.connections.get(id)?.connection
  }

  all(): TopicConnection<P>[] {
    return [...this.connections.values()].map((entry) => entry.connection)
  }

  /**
   * Deliver `item` to every connection subscribed to `topic`, or to its
   * kind's wildcard: once per connection, and once per group for the members
   * it reaches. Returns the connection ids reached.
   */
  publish(topic: TopicRef, item: T): string[] {
    const reached = this.subscribers(topic)
    const groups = new Map<TopicGroup<T>, string[]>()
    for (const id of reached) {
      const entry = this.connections.get(id)
      if (!entry) continue
      if ('group' in entry.sink) {
        let members = groups.get(entry.sink.group)
        if (!members) groups.set(entry.sink.group, members = [])
        members.push(id)
        continue
      }
      this.guard(id, topic, () => (entry.sink as TopicSink<T>).deliver(topic, item))
    }
    for (const [group, members] of groups) this.guard(members.join(','), topic, () => group.deliver(topic, item, members))
    return reached
  }

  /** Connection ids a publish to `topic` reaches, in subscription order. */
  subscribers(topic: TopicRef): string[] {
    const ids = new Set(this.routes.get(topicKey(topic)) ?? [])
    const wildcard = topicWildcardKey(topic)
    if (wildcard && !isTopicWildcard(topic)) for (const id of this.routes.get(wildcard) ?? []) ids.add(id)
    return [...ids]
  }

  /** Every topic some connection is subscribed to, with how many connections hold it. */
  interest(): Array<{ topic: TopicRef; connections: number }> {
    const out: Array<{ topic: TopicRef; connections: number }> = []
    for (const [key, ids] of this.routes) {
      const topic = this.topicOf(key, ids)
      if (topic) out.push({ topic, connections: ids.size })
    }
    return out
  }

  /** Called when a topic gains its first subscriber or loses its last. */
  onInterest(listener: InterestListener): () => void {
    this.interestListeners.add(listener)
    return () => { this.interestListeners.delete(listener) }
  }

  private guard(id: string, topic: TopicRef, deliver: () => void): void {
    try {
      deliver()
    } catch (error) {
      this.options.onSinkError?.(id, topic, error)
    }
  }

  private topicOf(key: string, ids: ReadonlySet<string>): TopicRef | undefined {
    for (const id of ids) {
      const topic = this.connections.get(id)?.topics.get(key)
      if (topic) return topic
    }
    return undefined
  }

  private route(key: string, topic: TopicRef, id: string, add: boolean): void {
    let ids = this.routes.get(key)
    if (add) {
      if (!ids) this.routes.set(key, ids = new Set())
      const first = ids.size === 0
      ids.add(id)
      if (first) this.emitInterest(topic, true)
      return
    }
    if (!ids?.delete(id)) return
    if (ids.size === 0) {
      this.routes.delete(key)
      this.emitInterest(topic, false)
    }
  }

  private emitInterest(topic: TopicRef, interested: boolean): void {
    for (const listener of [...this.interestListeners]) listener(topic, interested)
  }
}
