/**
 * Follows the runs of spawn children on other machines for the child
 * monitor, independent of whichever chat drain streams them to the UI. Each
 * child keeps the node event sequence processed so far in its grant, so a
 * restart or reconnect of this desktop resumes from there: no stop is missed
 * and none is seen twice.
 */

import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionAgentRemoteLaunch } from '@superone/shared/agent-types'
import { createNodeSessionEventMapper, type NodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { parseGrantConfig, type CollaborationGrantRow } from '@superone/runtime/collaboration'
import log from '../logger'
import { collaborationStore } from './collaboration-mailbox'
import { remotePort } from './collaboration-remote'

export const REMOTE_CHILD_POLL_MS = 2_000
/** A page of `session.events` holds at most this many events. */
const EVENT_PAGE = 1000

export interface RemoteChildRunFeed {
  handleEvent(sessionId: string, event: AgentEvent, replay: boolean): void
  resumeRun(sessionId: string): void
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
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly feed: RemoteChildRunFeed) {}

  start(intervalMs = REMOTE_CHILD_POLL_MS): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
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
      const env = environments.find((item) => item.environmentId === environmentId)
      if (!env?.connected) {
        // Read the run state again once the machine is back.
        for (const child of children) this.resumed.delete(child.sessionId)
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
    for (const child of children) {
      if (this.resumed.has(child.sessionId)) continue
      // A run open at the cursor, or running now, ends in a stop that must count.
      const state = child.remote.runOpen ? null : await port.getSession(connectionId, child.sessionId)
      if (child.remote.runOpen || state?.status === 'streaming') this.feed.resumeRun(child.sessionId)
      this.resumed.add(child.sessionId)
    }
    const runOpen = new Map(children.map((child) => [child.sessionId, child.remote.runOpen === true]))
    const cursors = new Map(children.map((child) => [child.sessionId, seq(child.remote.eventCursor)]))
    let after = [...cursors.values()].reduce((min, value) => (value < min ? value : min))
    for (;;) {
      const page = await port.listEvents(connectionId, after.toString())
      for (const envelope of page) {
        const at = seq(envelope.sequence)
        after = at
        const cursor = envelope.aggregateType === 'session' ? cursors.get(envelope.aggregateId) : undefined
        if (cursor === undefined || at <= cursor) continue
        cursors.set(envelope.aggregateId, at)
        const events = this.mapper(envelope.aggregateId).map(envelope)
        for (const event of events) {
          this.feed.handleEvent(envelope.aggregateId, event, false)
          if (event.type === 'status_change') {
            runOpen.set(envelope.aggregateId, event.status === 'streaming' || event.status === 'background')
          }
        }
        // A stop may have woken the parent: record it before anything can replay it.
        if (events.some((event) => event.type === 'status_change')) {
          this.save(children, envelope.aggregateId, at, runOpen.get(envelope.aggregateId)!)
        }
      }
      if (page.length > 0) {
        // Nothing of the others happened up to here either.
        for (const [sessionId, value] of cursors) if (value < after) cursors.set(sessionId, after)
        for (const child of children) this.save(children, child.sessionId, cursors.get(child.sessionId)!, runOpen.get(child.sessionId)!)
      }
      if (page.length < EVENT_PAGE) return
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

  private save(children: Child[], sessionId: string, cursor: bigint, runOpen: boolean): void {
    const child = children.find((item) => item.sessionId === sessionId)
    if (!child || (seq(child.remote.eventCursor) >= cursor && child.remote.runOpen === runOpen)) return
    child.remote = { ...child.remote, eventCursor: cursor.toString(), runOpen }
    const store = collaborationStore()
    const config = parseGrantConfig(store.grantById(child.grant.grant_id)?.config_json ?? child.grant.config_json)
    store.updateConfig(child.grant.grant_id, { ...config, remote: child.remote })
  }
}
