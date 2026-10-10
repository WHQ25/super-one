/**
 * Follows the runs of spawn children on other machines for the child
 * monitor, independent of whichever chat drain streams them to the UI. Each
 * child keeps the node event sequence processed so far, and the run open
 * there, in its grant, so a restart or reconnect of this desktop resumes from
 * there: no stop is missed and none is seen twice.
 *
 * Reads are woken, not timed: by the node pushing an event of a child, by a
 * machine connecting or disconnecting, and by a child starting (`wake`).
 */

import { isEnvironment } from '@superone/shared/environment/client-view'
import type { AgentEvent, SessionAgentRemoteLaunch, SessionAgentRunState } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope } from '@superone/shared/environment'
import { createNodeSessionEventMapper, type NodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { parseGrantConfig, type CollaborationGrantRow } from '@superone/runtime/collaboration'
import log from '../logger'
import { collaborationStore } from './collaboration-mailbox'
import { remotePort } from './collaboration-remote'

/** A page of `session.events` holds at most this many events. */
const EVENT_PAGE = 1000

/** The {@link CollaborationChildMonitor} surface the watcher drives. */
export interface RemoteChildRunFeed {
  handleEvent(sessionId: string, event: AgentEvent, replay: boolean, stopKey?: string): void
  resumeRun(sessionId: string, state?: SessionAgentRunState): void
  supersedeStop(sessionId: string): void
  runState(sessionId: string): SessionAgentRunState | null
  stopRun(sessionId: string, status: string, stopKey?: string): void
}

interface Child {
  grant: CollaborationGrantRow
  sessionId: string
  remote: SessionAgentRemoteLaunch
}

function seq(value: string | undefined): bigint {
  try {
    return BigInt(value || '0')
  } catch {
    return 0n
  }
}

export class RemoteChildWatcher {
  private readonly mappers = new Map<string, NodeSessionEventMapper>()
  /** Children whose live run state was read since this desktop (re)connected their machine. */
  private readonly resumed = new Set<string>()
  private readonly polling = new Set<string>()
  /** Children whose node pushes wake this watcher, with their unwatch. */
  private readonly watched = new Map<string, () => void>()
  private started = false
  private stopConnections: (() => void) | null = null
  private running: Promise<void> | null = null
  private again = false

  constructor(private readonly feed: RemoteChildRunFeed) {}

  start(): void {
    if (this.started) return
    this.started = true
    void remotePort().then((port) => {
      if (!this.started) return
      this.stopConnections = port.onConnectionChange(() => this.wake())
      this.wake()
    })
  }

  stop(): void {
    this.started = false
    this.stopConnections?.()
    this.stopConnections = null
    for (const unwatch of this.watched.values()) unwatch()
    this.watched.clear()
  }

  /** Read every connected machine again; a wake during a read runs one more. */
  wake(): void {
    if (this.running) {
      this.again = true
      return
    }
    this.running = this.tick().finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        this.wake()
      }
    })
  }

  /** One poll of every connected machine with remote children. */
  async tick(): Promise<void> {
    const byEnvironment = new Map<string, Child[]>()
    for (const grant of collaborationStore().startedSpawnGrants()) {
      const remote = parseGrantConfig(grant.config_json).remote
      if (!remote || !grant.child_session_id) continue
      const children = byEnvironment.get(remote.environmentId) ?? []
      children.push({ grant, sessionId: grant.child_session_id, remote })
      byEnvironment.set(remote.environmentId, children)
    }
    if (byEnvironment.size === 0) return
    let environments: Awaited<ReturnType<Awaited<ReturnType<typeof remotePort>>['listEnvironments']>>
    try {
      environments = await (await remotePort()).listEnvironments()
    } catch {
      return
    }
    await Promise.all([...byEnvironment].map(async ([environmentId, children]) => {
      const env = environments.find((item) => isEnvironment(item, environmentId))
      if (!env?.connected) {
        // Read the run state again once the machine is back, and watch again then.
        for (const child of children) {
          this.resumed.delete(child.sessionId)
          this.watched.get(child.sessionId)?.()
          this.watched.delete(child.sessionId)
        }
        return
      }
      if (this.polling.has(environmentId)) return
      this.polling.add(environmentId)
      try {
        await this.poll(env.connectionId, children)
      } catch (error) {
        log.debug('[session-collaboration] remote child poll failed env=%s: %s', environmentId, error instanceof Error ? error.message : String(error))
      } finally {
        this.polling.delete(environmentId)
      }
    }))
  }

  private async poll(connectionId: string, children: Child[]): Promise<void> {
    const port = await remotePort()
    // Watch before reading: an event committed after this read still wakes a new one.
    for (const child of children) {
      if (this.watched.has(child.sessionId)) continue
      this.watched.set(child.sessionId, await port.watchEvents(connectionId, child.sessionId, () => this.wake()))
    }
    /** Node status of children whose run state was just resumed while their node says it is not running. */
    const settled = new Map<string, string>()
    for (const child of children) {
      if (this.resumed.has(child.sessionId)) continue
      const state = await port.getSession(connectionId, child.sessionId)
      // A run open at the cursor, or running now, ends in a stop that must count.
      if (child.remote.run) this.feed.resumeRun(child.sessionId, child.remote.run)
      else if (state?.status === 'streaming') this.feed.resumeRun(child.sessionId)
      if (state?.status === 'streaming') this.feed.supersedeStop(child.sessionId)
      if (state && state.status !== 'streaming' && this.feed.runState(child.sessionId)) settled.set(child.sessionId, state.status)
      this.resumed.add(child.sessionId)
    }
    const store = collaborationStore()
    const cursors = new Map(children.map((child) => [child.sessionId, seq(child.remote.eventCursor)]))
    /** Children whose run opened or stopped in the events read now. */
    const statusSeen = new Set<string>()
    let after = [...cursors.values()].reduce((min, value) => (value < min ? value : min))
    for (;;) {
      const page = await port.listEvents(connectionId, after.toString())
      for (const envelope of page) {
        const at = seq(envelope.sequence)
        after = at
        const sessionId = envelope.aggregateId
        const cursor = envelope.aggregateType === 'session' ? cursors.get(sessionId) : undefined
        if (cursor === undefined || at <= cursor) continue
        cursors.set(sessionId, at)
        const events = this.mapper(sessionId).map(envelope)
        const restarted = restartStop(envelope)
        if (restarted || events.some((event) => event.type === 'status_change')) statusSeen.add(sessionId)
        // A stop records its parent wake with the cursor past it, or neither.
        store.transaction(() => {
          for (const event of events) this.feed.handleEvent(sessionId, event, false, envelope.sequence)
          if (restarted && this.feed.runState(sessionId)) this.feed.stopRun(sessionId, restarted, envelope.sequence)
          this.save(children, sessionId, at, 'run')
        })
      }
      if (page.length > 0) {
        // Nothing of the others happened up to here either.
        for (const [sessionId, value] of cursors) if (value < after) cursors.set(sessionId, after)
        for (const child of children) this.save(children, child.sessionId, cursors.get(child.sessionId)!, 'cursor')
      }
      if (page.length < EVENT_PAGE) break
    }
    // The node settled a run this desktop resumed without logging its stop (an older node).
    for (const [sessionId, status] of settled) {
      if (statusSeen.has(sessionId) || !this.feed.runState(sessionId)) continue
      const cursor = cursors.get(sessionId)!
      store.transaction(() => {
        this.feed.stopRun(sessionId, status, `settled:${cursor}`)
        this.save(children, sessionId, cursor, 'run')
      })
    }
  }

  private mapper(sessionId: string): NodeSessionEventMapper {
    let mapper = this.mappers.get(sessionId)
    if (!mapper) {
      mapper = createNodeSessionEventMapper({ sessionId, skipUserMessage: true })
      this.mappers.set(sessionId, mapper)
    }
    return mapper
  }

  /**
   * Record the cursor with the run open there: when the run changed
   * (`'run'`), or when the cursor advanced (`'cursor'`).
   */
  private save(children: Child[], sessionId: string, cursor: bigint, when: 'run' | 'cursor'): void {
    const child = children.find((item) => item.sessionId === sessionId)
    if (!child) return
    const run = this.feed.runState(sessionId) ?? undefined
    const advanced = seq(child.remote.eventCursor) < cursor
    const runChanged = JSON.stringify(run) !== JSON.stringify(child.remote.run)
    if (when === 'run' ? !runChanged : !advanced) return
    const { run: _previous, ...remote } = child.remote
    child.remote = { ...remote, eventCursor: cursor.toString(), ...(run ? { run } : {}) }
    const store = collaborationStore()
    const config = parseGrantConfig(store.grantById(child.grant.grant_id)?.config_json ?? child.grant.config_json)
    store.updateConfig(child.grant.grant_id, { ...config, remote: child.remote })
  }
}

/** The stop a node logged for a run its restart ended; null for any other event. */
function restartStop(envelope: EnvironmentEventEnvelope): string | null {
  if (envelope.eventType !== SESSION_DURABLE_EVENT.reconciled) return null
  const status = (envelope.payload as { status?: unknown } | null)?.status
  if (typeof status !== 'string' || status === 'streaming') return null
  return `${status} (its machine restarted)`
}
