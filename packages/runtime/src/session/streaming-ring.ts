import type { EnvironmentEventEnvelope, StreamingEventKey } from '@superone/shared/environment'

/** Streaming events held across every session; about two long Codex turns' worth. */
export const STREAMING_RING_MAX_BYTES = 16 * 1024 * 1024

interface Entry {
  sessionId: string
  envelope: EnvironmentEventEnvelope
  key: StreamingEventKey
  bytes: number
  removed: boolean
}

interface SessionRing {
  entries: Entry[]
  /** Highest version dropped without a newer event carrying it; a reader below it has a gap. */
  floor: number
}

/**
 * The streaming tier: events of messages still streaming, per session, in
 * version order. A message's events go when it commits, and the oldest ones
 * when the byte cap is reached; either way the session's floor rises, so a
 * reader that had not seen them knows to read the snapshot instead. A Codex
 * item update replaces the previous one of the same item without raising it.
 */
export class StreamingRing {
  private readonly sessions = new Map<string, SessionRing>()
  /** Every live entry in insertion order, for eviction; removed ones are skipped. */
  private order: Entry[] = []
  private bytes = 0

  constructor(private readonly maxBytes = STREAMING_RING_MAX_BYTES) {}

  add(envelope: EnvironmentEventEnvelope, key: StreamingEventKey): void {
    const ring = this.ring(envelope.aggregateId)
    if (key.supersedes) {
      const previous = ring.entries.findIndex((entry) => entry.key.supersedes === key.supersedes)
      if (previous >= 0) this.drop(ring, previous, false)
    }
    const entry: Entry = {
      sessionId: envelope.aggregateId,
      envelope,
      key,
      bytes: JSON.stringify(envelope.payload).length,
      removed: false,
    }
    ring.entries.push(entry)
    this.order.push(entry)
    this.bytes += entry.bytes
    while (this.bytes > this.maxBytes) this.evictOldest()
  }

  /** Drops a session's events of one message, or all of them (`null`: the turn ended). */
  retire(sessionId: string, messageId: string | null): void {
    const ring = this.sessions.get(sessionId)
    if (!ring) return
    for (let i = ring.entries.length - 1; i >= 0; i--) {
      if (messageId === null || ring.entries[i].key.messageId === messageId) this.drop(ring, i, true)
    }
  }

  /** A session's events above `version`, or null when some of them are gone. */
  after(sessionId: string, version: number): EnvironmentEventEnvelope[] | null {
    const ring = this.sessions.get(sessionId)
    if (!ring) return []
    if (version < ring.floor) return null
    return ring.entries.filter((entry) => entry.envelope.sessionVersion! > version).map((entry) => entry.envelope)
  }

  /** Every session's held events, for readers that start without versions. */
  all(): EnvironmentEventEnvelope[] {
    return this.order.filter((entry) => !entry.removed).map((entry) => entry.envelope)
  }

  get size(): number {
    return this.bytes
  }

  private ring(sessionId: string): SessionRing {
    let ring = this.sessions.get(sessionId)
    if (!ring) this.sessions.set(sessionId, ring = { entries: [], floor: 0 })
    return ring
  }

  private drop(ring: SessionRing, index: number, raisesFloor: boolean): void {
    const [entry] = ring.entries.splice(index, 1)
    entry.removed = true
    this.bytes -= entry.bytes
    if (raisesFloor) ring.floor = Math.max(ring.floor, entry.envelope.sessionVersion!)
    if (this.order.length > 64 && this.order.length > 2 * this.liveCount()) this.order = this.order.filter((e) => !e.removed)
  }

  private liveCount(): number {
    let count = 0
    for (const ring of this.sessions.values()) count += ring.entries.length
    return count
  }

  private evictOldest(): void {
    const oldest = this.order.find((entry) => !entry.removed)
    if (!oldest) return
    const ring = this.sessions.get(oldest.sessionId)!
    this.drop(ring, ring.entries.indexOf(oldest), true)
  }
}
