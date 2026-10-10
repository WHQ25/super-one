import { randomUUID } from 'node:crypto'
import type { TopicRecovery, TopicVersionCursor } from '@superone/shared/environment/topics'

/**
 * Recovery for a snapshot-plus-changes topic (session list, projects,
 * drafts): each change gets the next version, and a bounded window of recent
 * changes lets a reader that was briefly away resume from its version. A
 * reader further behind, or from another process (epoch), reads the snapshot
 * again.
 */
export class VersionedTopicLog<T> {
  readonly epoch: string
  private version = 0
  private readonly changes: Array<{ version: number; item: T }> = []

  constructor(private readonly capacity = 256, epoch: string = randomUUID()) {
    this.epoch = epoch
  }

  cursor(): TopicVersionCursor {
    return { epoch: this.epoch, version: this.version }
  }

  /** Record a change; returns the version it was given. */
  append(item: T): number {
    this.version += 1
    this.changes.push({ version: this.version, item })
    if (this.changes.length > this.capacity) this.changes.splice(0, this.changes.length - this.capacity)
    return this.version
  }

  /** The changes after `from`, or `resnapshot` when some of them are gone. */
  since(from: TopicVersionCursor | null | undefined): TopicRecovery<T> {
    const cursor = this.cursor()
    if (!from || from.epoch !== this.epoch || from.version > this.version) return { kind: 'resnapshot', cursor }
    if (from.version === this.version) return { kind: 'replay', items: [], cursor }
    const oldest = this.changes[0]?.version
    if (oldest === undefined || from.version + 1 < oldest) return { kind: 'resnapshot', cursor }
    return { kind: 'replay', items: this.changes.filter((change) => change.version > from.version).map((change) => change.item), cursor }
  }
}
